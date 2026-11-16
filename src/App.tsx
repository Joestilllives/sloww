import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Lock, RotateCcw, Sunrise, WifiOff, X } from 'lucide-react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import {
  auth,
  batchUpdateNodePositions,
  commitUnpackedDump,
  createBranchedNode,
  createBrainDump,
  createMapEdge,
  createMapNode,
  createMindMap,
  createSafeId,
  db,
  deleteBrainDump,
  deleteMapEdge,
  deleteMapNode,
  deleteMindMap,
  fetchAllSanctuarySearchIndex,
  fetchUserProfile,
  getMapCollections,
  googleProvider,
  handleFirestoreError,
  importGuestSanctuaryBundle,
  incrementMapNourishment,
  OperationType,
  replacePatterns,
  resetMapNourishment,
  restoreDeletedBundle,
  sanitizeKind,
  sanitizeTier,
  sanitizeTone,
  updateActiveMapId,
  updateMapEdge,
  updateMapNode,
  updateMindMapDetails,
  upsertUserProfile,
} from './lib/firebase';
import { exportSanctuaryAsJson, type ExportableSanctuary } from './lib/exportSanctuary';
import {
  computeArrangedPositions,
  computeBranchPosition,
  computeHarmonyPositions,
} from './lib/layout';
import { seedStarterSanctuary } from './lib/starterMap';
import {
  clearGuestSandbox,
  createInitialGuestSandbox,
  loadGuestSandbox,
  saveGuestSandbox,
  type GuestSandboxState,
} from './lib/guestSandbox';
import { getStillpointTestAdapter, type TestAuthUser } from './lib/e2eBridge';
import type {
  BrainDump,
  CompanionNote,
  FindPatternsResponse,
  MapEdge,
  MapNode,
  MindMap,
  NodeKind,
  PatternInsight,
  PriorityTier,
  UnpackDumpResponse,
} from './types';
import { TopBar, type MobileSection } from './components/TopBar';
import { SensoryBar } from './components/SensoryBar';
import { BrainDumpRail } from './components/BrainDumpRail';
import { MindMapCanvas } from './components/MindMapCanvas';
import { CompanionAndPatternsRail } from './components/CompanionAndPatternsRail';
import { SanctuariesModal } from './components/SanctuariesModal';

function getCreatedMillis(item: { createdAt?: unknown }): number {
  const ts = item.createdAt as { toMillis?: () => number } | undefined;
  return typeof ts?.toMillis === 'function' ? ts.toMillis() : 0;
}

function sortByCreatedAt<T extends { createdAt?: unknown }>(
  items: T[],
  dir: 'asc' | 'desc' = 'asc'
): T[] {
  return [...items].sort((a, b) => {
    const diff = getCreatedMillis(a) - getCreatedMillis(b);
    return dir === 'asc' ? diff : -diff;
  });
}

function buildPatternCascadeForDeletedNodes(
  patterns: PatternInsight[],
  removedNodeIds: Set<string>
): {
  patternUpdates: Array<{ id: string; remainingNodeIds: string[] }>;
  patternDeleteIds: string[];
} {
  const patternUpdates: Array<{ id: string; remainingNodeIds: string[] }> = [];
  const patternDeleteIds: string[] = [];

  for (const pat of patterns) {
    if (pat.relatedNodeIds.some((id) => removedNodeIds.has(id))) {
      const remaining = pat.relatedNodeIds.filter((id) => !removedNodeIds.has(id));
      if (remaining.length === 0) {
        patternDeleteIds.push(pat.id);
      } else {
        patternUpdates.push({ id: pat.id, remainingNodeIds: remaining });
      }
    }
  }

  return { patternUpdates, patternDeleteIds };
}

interface PendingUndo {
  id: string;
  label: string;
  mapId: string;
  nodes: MapNode[];
  edges: MapEdge[];
  dumps: BrainDump[];
  createdPatterns: PatternInsight[];
  updatedPatterns: Array<{ id: string; relatedNodeIds: string[] }>;
}

function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /\b(Reddit|Instagram|FBAN|FBAV|Line|MicroMessenger|Twitter|LinkedInApp)\b/i.test(
    navigator.userAgent
  );
}

function formatAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const msg = error instanceof Error ? error.message : String(error || '');

  if (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    msg.includes('popup-blocked')
  ) {
    return isInAppBrowser()
      ? 'This in-app browser blocked the Google popup. Try redirect sign-in below or open Sloww in Safari/Chrome — your local Sanctuary stays safe.'
      : 'Your browser blocked the Google sign-in popup. Try redirect sign-in below or allow popups — your local Sanctuary stays safe.';
  }
  if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
    return 'Google sign-in was closed before finishing. Your local Sanctuary is still saved in this browser.';
  }
  if (code === 'auth/cancelled-popup-request' || msg.includes('cancelled-popup-request')) {
    return 'Another sign-in window was already open. Please try again.';
  }
  if (code === 'auth/network-request-failed' || msg.includes('network-request-failed')) {
    return 'Connection paused before Google sign-in finished. Check your connection and try again.';
  }
  return msg || 'Unable to sign in right now. Your local Sanctuary stays safe in this browser.';
}

const DAILY_CHECKIN_KEY = 'stillpoint_daily_checkin_v1';

interface DailyCheckInState {
  lastSeenDay: string;
  dismissedForDay?: string;
}

function getLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readDailyCheckInState(): DailyCheckInState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DAILY_CHECKIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyCheckInState>;
    if (!parsed || typeof parsed.lastSeenDay !== 'string') return null;
    return {
      lastSeenDay: parsed.lastSeenDay,
      dismissedForDay: typeof parsed.dismissedForDay === 'string' ? parsed.dismissedForDay : '',
    };
  } catch {
    return null;
  }
}

function saveDailyCheckInState(state: DailyCheckInState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DAILY_CHECKIN_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export default function App() {
  const [user, setUser] = useState<User | TestAuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authOfferRedirect, setAuthOfferRedirect] = useState(false);
  const [isMigratingGuest, setIsMigratingGuest] = useState(false);

  // Cloud Firestore state (when signed in)
  const [maps, setMaps] = useState<MindMap[]>([]);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [dumps, setDumps] = useState<BrainDump[]>([]);
  const [patterns, setPatterns] = useState<PatternInsight[]>([]);

  // Local-browser sandbox state (for immediate frictionless entry before sign-in)
  const [guestState, setGuestState] = useState<GuestSandboxState>(() => loadGuestSandbox());
  const guestStateRef = useRef(guestState);
  guestStateRef.current = guestState;

  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>('patterns');
  const [sanctuariesOpen, setSanctuariesOpen] = useState(false);

  const [isUnpacking, setIsUnpacking] = useState(false);
  const [unpackingDumpId, setUnpackingDumpId] = useState<string | null>(null);
  const [dumpError, setDumpError] = useState<string | null>(null);

  const [isFindingPatterns, setIsFindingPatterns] = useState(false);
  const [isAskingCompanion, setIsAskingCompanion] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);

  const [isNewDayReturn, setIsNewDayReturn] = useState<boolean>(() => {
    const today = getLocalDayKey();
    const stored = readDailyCheckInState();
    if (!stored) {
      saveDailyCheckInState({ lastSeenDay: today, dismissedForDay: '' });
      return false;
    }
    return stored.lastSeenDay !== today && stored.dismissedForDay !== today;
  });
  const [isEasingTodayCards, setIsEasingTodayCards] = useState(false);
  const [privacyNoteOpen, setPrivacyNoteOpen] = useState(false);

  const seedingRef = useRef(false);
  const migratingRef = useRef(false);
  const unpackLockRef = useRef(false);
  const undoLockRef = useRef(false);
  const preferredMapIdRef = useRef<string | null>(null);
  const lastAutoCelebrateAtRef = useRef<number>(0);
  const lastPatternFingerprintRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setOfflineBannerDismissed(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setOfflineBannerDismissed(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!pendingUndo) return;
    const timer = window.setTimeout(() => {
      setPendingUndo((current) => (current?.id === pendingUndo.id ? null : current));
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [pendingUndo]);

  const updateGuestSandbox = useCallback(
    (
      updater: (prev: GuestSandboxState) => GuestSandboxState,
      markInteracted = true
    ) => {
      setGuestState((prev) => {
        const updated = updater(prev);
        const next: GuestSandboxState = markInteracted
          ? { ...updated, hasInteracted: true }
          : updated;
        saveGuestSandbox(next);
        return next;
      });
    },
    []
  );

  // 1. Auth Listener, Redirect Check, Profile Sync & Guest Sandbox Migration
  useEffect(() => {
    const testAdapter = getStillpointTestAdapter();

    if (!testAdapter) {
      void getRedirectResult(auth).catch((error) => {
        setAuthError(formatAuthError(error));
      });
    }

    const handleAuthChange = (currentUser: User | TestAuthUser | null) => {
      setUser(currentUser);
      setAuthReady(true);

      if (currentUser) {
        setAuthError(null);
        setAuthOfferRedirect(false);
        preferredMapIdRef.current = null;
        const snapshotGuest = guestStateRef.current;

        if (!testAdapter) {
          void upsertUserProfile({
            uid: currentUser.uid,
            displayName: currentUser.displayName || 'Quiet Thinker',
            email: currentUser.email || 'user@example.com',
          });
        }

        if (snapshotGuest.hasInteracted && !migratingRef.current) {
          migratingRef.current = true;
          setIsMigratingGuest(true);

          void (async () => {
            try {
              let importedActiveId: string | null = null;
              for (const gMap of snapshotGuest.maps) {
                const bundle: ExportableSanctuary = {
                  map: gMap,
                  nodes: snapshotGuest.nodes.filter((n) => n.mapId === gMap.id),
                  edges: snapshotGuest.edges.filter((e) => e.mapId === gMap.id),
                  dumps: snapshotGuest.dumps.filter((d) => d.mapId === gMap.id),
                  patterns: snapshotGuest.patterns.filter((p) => p.mapId === gMap.id),
                };
                const importedId = testAdapter
                  ? await testAdapter.importGuestSanctuaryBundle(currentUser.uid, bundle)
                  : await importGuestSanctuaryBundle(currentUser.uid, bundle);

                if (gMap.id === snapshotGuest.activeMapId || !importedActiveId) {
                  importedActiveId = importedId;
                }
              }
              if (importedActiveId) {
                preferredMapIdRef.current = importedActiveId;
                setActiveMapId(importedActiveId);
                if (testAdapter) {
                  await testAdapter.updateActiveMapId(currentUser.uid, importedActiveId);
                } else {
                  await updateActiveMapId(currentUser.uid, importedActiveId);
                }
              }
              clearGuestSandbox();
              setGuestState(createInitialGuestSandbox());
            } catch (error) {
              console.error('Guest sandbox migration error:', error);
            } finally {
              migratingRef.current = false;
              setIsMigratingGuest(false);
            }
          })();
        } else {
          // Untouched sandbox: clear and load user's cloud profile/maps cleanly
          clearGuestSandbox();
          if (!testAdapter) {
            void fetchUserProfile(currentUser.uid)
              .then((profile) => {
                if (profile?.activeMapId) {
                  preferredMapIdRef.current = profile.activeMapId;
                  setActiveMapId((prev) => prev || profile.activeMapId || null);
                }
              })
              .catch(() => {
                // Non-blocking fallback to first loaded map
              });
          }
        }
      } else {
        preferredMapIdRef.current = null;
        setMaps([]);
        setMapsLoaded(false);
        setActiveMapId(null);
        setNodes([]);
        setEdges([]);
        setDumps([]);
        setPatterns([]);
        setGuestState(loadGuestSandbox());
      }
    };

    const unsub = testAdapter
      ? testAdapter.onAuthStateChanged(handleAuthChange)
      : onAuthStateChanged(auth, handleAuthChange);
    return () => unsub();
  }, []);

  // 2. Listen to user's saved maps when signed in (after any guest migration completes)
  useEffect(() => {
    if (!authReady || !user || isMigratingGuest) return;

    const testAdapter = getStillpointTestAdapter();
    if (testAdapter) {
      return testAdapter.subscribeMaps(user.uid, (loadedMaps) => {
        setMaps(loadedMaps);
        setMapsLoaded(true);
        setActiveMapId((prev) => {
          if (preferredMapIdRef.current && loadedMaps.some((m) => m.id === preferredMapIdRef.current)) {
            return preferredMapIdRef.current;
          }
          if (prev && loadedMaps.some((m) => m.id === prev)) return prev;
          return loadedMaps[0]?.id || null;
        });
      });
    }

    const mapsPath = `users/${user.uid}/maps`;
    const mapsQuery = query(
      collection(db, 'users', user.uid, 'maps'),
      where('ownerId', '==', user.uid)
    );

    const unsub = onSnapshot(
      mapsQuery,
      (snapshot) => {
        const loadedMaps = sortByCreatedAt(
          snapshot.docs.map((d) => d.data() as MindMap),
          'asc'
        );
        setMaps(loadedMaps);
        setMapsLoaded(true);

        if (loadedMaps.length === 0 && !seedingRef.current) {
          seedingRef.current = true;
          void seedStarterSanctuary(user.uid)
            .then((seededId) => {
              setActiveMapId(seededId);
            })
            .finally(() => {
              seedingRef.current = false;
            });
          return;
        }

        setActiveMapId((prev) => {
          if (preferredMapIdRef.current && loadedMaps.some((m) => m.id === preferredMapIdRef.current)) {
            return preferredMapIdRef.current;
          }
          if (prev && loadedMaps.some((m) => m.id === prev)) return prev;
          return loadedMaps[0]?.id || null;
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, mapsPath);
      }
    );

    return () => unsub();
  }, [authReady, user, isMigratingGuest]);

  // 3. Listen to active map subcollections when signed in
  useEffect(() => {
    if (!authReady || !user || !activeMapId || isMigratingGuest) {
      if (user) {
        setNodes([]);
        setEdges([]);
        setDumps([]);
        setPatterns([]);
      }
      return;
    }

    const testAdapter = getStillpointTestAdapter();
    if (testAdapter) {
      setActivePatternId(null);
      return testAdapter.subscribeMapData(user.uid, activeMapId, (data) => {
        setNodes(data.nodes);
        setEdges(data.edges);
        setDumps(data.dumps);
        setPatterns(data.patterns);
      });
    }

    const { nodesCol, edgesCol, dumpsCol, patternsCol } = getMapCollections(user.uid, activeMapId);
    const basePath = `users/${user.uid}/maps/${activeMapId}`;
    const ownerFilter = where('ownerId', '==', user.uid);

    const unsubNodes = onSnapshot(
      query(nodesCol, ownerFilter),
      (snap) => setNodes(sortByCreatedAt(snap.docs.map((d) => d.data() as MapNode), 'asc')),
      (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/nodes`)
    );

    const unsubEdges = onSnapshot(
      query(edgesCol, ownerFilter),
      (snap) => setEdges(sortByCreatedAt(snap.docs.map((d) => d.data() as MapEdge), 'asc')),
      (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/edges`)
    );

    const unsubDumps = onSnapshot(
      query(dumpsCol, ownerFilter),
      (snap) => setDumps(sortByCreatedAt(snap.docs.map((d) => d.data() as BrainDump), 'desc')),
      (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/dumps`)
    );

    const unsubPatterns = onSnapshot(
      query(patternsCol, ownerFilter),
      (snap) => setPatterns(sortByCreatedAt(snap.docs.map((d) => d.data() as PatternInsight), 'asc')),
      (err) => handleFirestoreError(err, OperationType.LIST, `${basePath}/patterns`)
    );

    setActivePatternId(null);

    return () => {
      unsubNodes();
      unsubEdges();
      unsubDumps();
      unsubPatterns();
    };
  }, [authReady, user, activeMapId, isMigratingGuest]);

  // Unified workspace data (Cloud when signed in, Local Sandbox otherwise)
  const isGuestMode = !user;

  const currentMaps = useMemo(
    () => (user ? maps : guestState.maps),
    [user, maps, guestState.maps]
  );

  const currentActiveMapId = user ? activeMapId : guestState.activeMapId;

  const activeMap = useMemo(
    () => currentMaps.find((m) => m.id === currentActiveMapId) || null,
    [currentMaps, currentActiveMapId]
  );

  const currentNodes = useMemo(
    () =>
      user
        ? nodes
        : guestState.nodes.filter((n) => n.mapId === guestState.activeMapId),
    [user, nodes, guestState.nodes, guestState.activeMapId]
  );

  const currentEdges = useMemo(
    () =>
      user
        ? edges
        : guestState.edges.filter((e) => e.mapId === guestState.activeMapId),
    [user, edges, guestState.edges, guestState.activeMapId]
  );

  const currentDumps = useMemo(
    () =>
      user
        ? dumps
        : guestState.dumps.filter((d) => d.mapId === guestState.activeMapId),
    [user, dumps, guestState.dumps, guestState.activeMapId]
  );

  const currentPatterns = useMemo(
    () =>
      user
        ? patterns
        : guestState.patterns.filter((p) => p.mapId === guestState.activeMapId),
    [user, patterns, guestState.patterns, guestState.activeMapId]
  );

  const activePattern = useMemo(
    () => currentPatterns.find((p) => p.id === activePatternId) || null,
    [currentPatterns, activePatternId]
  );

  const patternContentFingerprint = useMemo(
    () =>
      `${currentNodes.map((n) => `${n.id}:${n.text}:${n.completed ? 1 : 0}`).join('|')}::${currentDumps
        .map((d) => d.id)
        .join('|')}`,
    [currentNodes, currentDumps]
  );

  useEffect(() => {
    if (!activeMap?.id || currentPatterns.length === 0) return;
    if (!(activeMap.id in lastPatternFingerprintRef.current)) {
      lastPatternFingerprintRef.current[activeMap.id] = patternContentFingerprint;
    }
  }, [activeMap?.id, currentPatterns.length, patternContentFingerprint]);

  // --- Nourishment & Breathwork Handlers ---
  const handleBreathComplete = useCallback(() => {
    if (user && activeMapId) {
      void incrementMapNourishment(user.uid, activeMapId, 'breathCount');
    } else if (!user) {
      updateGuestSandbox((prev) => ({
        ...prev,
        maps: prev.maps.map((m) =>
          m.id === prev.activeMapId ? { ...m, breathCount: (m.breathCount ?? 0) + 1 } : m
        ),
      }));
    }
  }, [user, activeMapId, updateGuestSandbox]);

  const handleWaterPlant = useCallback(async () => {
    if (user && activeMapId) {
      await incrementMapNourishment(user.uid, activeMapId, 'waterDrops');
    } else if (!user) {
      updateGuestSandbox((prev) => ({
        ...prev,
        maps: prev.maps.map((m) =>
          m.id === prev.activeMapId ? { ...m, waterDrops: (m.waterDrops ?? 0) + 1 } : m
        ),
      }));
    }
  }, [user, activeMapId, updateGuestSandbox]);

  const handleResetPlant = useCallback(
    async (activityPoints: number) => {
      if (user && activeMapId) {
        await resetMapNourishment(user.uid, activeMapId, activityPoints);
      } else if (!user) {
        updateGuestSandbox((prev) => ({
          ...prev,
          maps: prev.maps.map((m) =>
            m.id === prev.activeMapId
              ? {
                  ...m,
                  breathCount: 0,
                  waterDrops: 0,
                  nourishmentOffset: Math.max(0, activityPoints),
                }
              : m
          ),
        }));
      }
    },
    [user, activeMapId, updateGuestSandbox]
  );

  // --- Auth Handlers ---
  const handleRedirectSignIn = async () => {
    setAuthError(null);
    setAuthOfferRedirect(false);
    setAuthLoading(true);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (error) {
      setAuthError(formatAuthError(error));
      setAuthLoading(false);
    }
  };

  const handleSignIn = async () => {
    setAuthError(null);
    setAuthOfferRedirect(false);
    setAuthLoading(true);
    try {
      const testAdapter = getStillpointTestAdapter();
      if (testAdapter) {
        await testAdapter.signInWithPopup();
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code || '')
          : '';
      const isPopupBlocked =
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment';

      if (isPopupBlocked && typeof window !== 'undefined' && window.self === window.top) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          setAuthError(formatAuthError(redirectError));
        }
      } else {
        setAuthError(formatAuthError(error));
        if (isPopupBlocked) {
          setAuthOfferRedirect(true);
        }
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const testAdapter = getStillpointTestAdapter();
    if (testAdapter) {
      await testAdapter.signOut();
      return;
    }
    await signOut(auth);
  };

  const handleFetchSearchIndex = useCallback(async () => {
    if (!user) {
      return {
        nodes: guestStateRef.current.nodes,
        dumps: guestStateRef.current.dumps,
      };
    }
    return fetchAllSanctuarySearchIndex(
      user.uid,
      maps.map((m) => m.id)
    );
  }, [user, maps]);

  // --- Sanctuary Switch / Create / Delete ---
  const handleSelectMap = async (mapId: string) => {
    setActivePatternId(null);
    setMobileSection('map');
    if (user) {
      preferredMapIdRef.current = mapId;
      setActiveMapId(mapId);
      await updateActiveMapId(user.uid, mapId);
    } else {
      updateGuestSandbox((prev) => ({ ...prev, activeMapId: mapId }), false);
    }
  };

  const handleCreateMap = async (title: string, intention: string) => {
    const mapId = createSafeId('map');
    const starterCompanion: CompanionNote = {
      title: 'A clean page',
      message:
        'Take a quiet moment before filling this space. Even two or three honest thoughts are enough to start seeing what wants your care.',
      tinyStep: 'Write one unedited thought in your Journal or double-click the canvas.',
    };

    if (user) {
      await createMindMap(user.uid, mapId, {
        title,
        intention,
        companionNote: starterCompanion,
      });
      await handleSelectMap(mapId);
    } else {
      const newMap: MindMap = {
        id: mapId,
        ownerId: 'guest',
        title: title.trim() || 'Untitled Sanctuary',
        intention: intention.trim(),
        encouragementTitle: starterCompanion.title,
        encouragementNote: starterCompanion.message,
        encouragementStep: starterCompanion.tinyStep,
        breathCount: 0,
        waterDrops: 0,
        nourishmentOffset: 0,
      };
      updateGuestSandbox((prev) => ({
        ...prev,
        activeMapId: mapId,
        maps: [...prev.maps, newMap],
      }));
      setMobileSection('map');
    }
  };

  const handleImportBundle = async (bundle: ExportableSanctuary) => {
    setPendingUndo(null);
    if (user) {
      const importedId = await importGuestSanctuaryBundle(user.uid, bundle);
      preferredMapIdRef.current = importedId;
      setActiveMapId(importedId);
      await updateActiveMapId(user.uid, importedId);
      setMobileSection('map');
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        activeMapId: bundle.map.id,
        maps: [...prev.maps, bundle.map],
        nodes: [...prev.nodes, ...bundle.nodes],
        edges: [...prev.edges, ...bundle.edges],
        dumps: [...prev.dumps, ...bundle.dumps],
        patterns: [...prev.patterns, ...bundle.patterns],
      }));
      setMobileSection('map');
    }
  };

  const handleDeleteMap = async (mapId: string) => {
    setPendingUndo((current) => (current?.mapId === mapId ? null : current));
    if (user) {
      const { nodesCol, edgesCol, dumpsCol, patternsCol } = getMapCollections(user.uid, mapId);
      const ownerFilter = where('ownerId', '==', user.uid);
      const [nSnap, eSnap, dSnap, pSnap] = await Promise.all([
        getDocs(query(nodesCol, ownerFilter)),
        getDocs(query(edgesCol, ownerFilter)),
        getDocs(query(dumpsCol, ownerFilter)),
        getDocs(query(patternsCol, ownerFilter)),
      ]);
      await deleteMindMap(user.uid, mapId, {
        nodeIds: nSnap.docs.map((d) => d.id),
        edgeIds: eSnap.docs.map((d) => d.id),
        dumpIds: dSnap.docs.map((d) => d.id),
        patternIds: pSnap.docs.map((d) => d.id),
      });
    } else {
      updateGuestSandbox((prev) => {
        const remainingMaps = prev.maps.filter((m) => m.id !== mapId);
        if (remainingMaps.length === 0) return prev;
        const nextActiveId =
          prev.activeMapId === mapId ? remainingMaps[0].id : prev.activeMapId;
        return {
          ...prev,
          activeMapId: nextActiveId,
          maps: remainingMaps,
          nodes: prev.nodes.filter((n) => n.mapId !== mapId),
          edges: prev.edges.filter((e) => e.mapId !== mapId),
          dumps: prev.dumps.filter((d) => d.mapId !== mapId),
          patterns: prev.patterns.filter((p) => p.mapId !== mapId),
        };
      });
    }
  };

  const handleUpdateMapDetails = async (updates: { title?: string; intention?: string }) => {
    if (!activeMap) return;
    if (user) {
      await updateMindMapDetails(user.uid, activeMap.id, updates);
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        maps: prev.maps.map((m) =>
          m.id === activeMap.id
            ? {
                ...m,
                ...(typeof updates.title === 'string' ? { title: updates.title } : {}),
                ...(typeof updates.intention === 'string' ? { intention: updates.intention } : {}),
              }
            : m
        ),
      }));
    }
  };

  // --- Brain Dump Handlers ---
  const runUnpackDump = useCallback(
    async (
      dumpId: string,
      rawText: string,
      moodWord: string | undefined,
      targetMap: MindMap,
      baseNodes: MapNode[]
    ): Promise<boolean> => {
      setDumpError(null);
      setIsUnpacking(true);
      try {
        const res = await fetch('/api/ai/unpack-dump', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawText,
            mapTitle: targetMap.title,
            intention: targetMap.intention || '',
            existingNodes: baseNodes.map((n) => ({
              id: n.id,
              text: n.text,
              kind: n.kind,
              priorityTier: n.priorityTier,
              completed: n.completed,
              theme: n.theme,
            })),
          }),
        });

        const data = (await res.json()) as UnpackDumpResponse & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Could not organize journal entry.');
        }

        const extracted = Array.isArray(data.extractedNodes)
          ? data.extractedNodes.slice(0, 6)
          : [];
        const positions = computeHarmonyPositions(extracted.length, baseNodes);
        const createdNodeIds: string[] = [];

        let nextNowOrder =
          baseNodes
            .filter((n) => n.priorityTier === 'now')
            .reduce((m, n) => Math.max(m, n.priorityOrder), 0) + 1;
        let nextOrder =
          baseNodes.reduce((m, n) => Math.max(m, n.priorityOrder), 0) + 1;

        const nodesToCreate = extracted.map((item, idx) => {
          const nodeId = createSafeId('node');
          createdNodeIds.push(nodeId);
          const tier = sanitizeTier(item.suggestedPriority);
          return {
            id: nodeId,
            text: item.text || 'Thought',
            note: item.note || '',
            kind: sanitizeKind(item.kind),
            priorityTier: tier,
            priorityOrder: tier === 'now' ? nextNowOrder++ : nextOrder++,
            completed: false,
            theme: item.theme || '',
            x: positions[idx]?.x ?? 100,
            y: positions[idx]?.y ?? 200,
            sourceDumpId: dumpId,
          };
        });

        const existingNodeIds = new Set(baseNodes.map((n) => n.id));
        const seenEdges = new Set<string>();
        const edgesToCreate: Array<
          Omit<MapEdge, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>
        > = [];

        const links = Array.isArray(data.suggestedLinks) ? data.suggestedLinks.slice(0, 5) : [];
        for (const link of links) {
          const fromId = createdNodeIds[link.fromIndex];
          const toId =
            typeof link.toIndex === 'number'
              ? createdNodeIds[link.toIndex]
              : link.toExistingNodeId && existingNodeIds.has(link.toExistingNodeId)
                ? link.toExistingNodeId
                : undefined;

          if (fromId && toId && fromId !== toId) {
            const pairKey = [fromId, toId].sort().join('::');
            if (!seenEdges.has(pairKey)) {
              seenEdges.add(pairKey);
              edgesToCreate.push({
                id: createSafeId('edge'),
                fromId,
                toId,
                label: link.label || 'connects to',
              });
            }
          }
        }

        if (user) {
          await commitUnpackedDump(user.uid, targetMap.id, {
            dumpId,
            moodWord: moodWord || data.moodWord || '',
            nodes: nodesToCreate,
            edges: edgesToCreate,
            companionNote: data.companionNote,
          });
        } else {
          const resolvedMood = moodWord || data.moodWord || '';
          updateGuestSandbox((prev) => ({
            ...prev,
            dumps: prev.dumps.map((d) =>
              d.id === dumpId
                ? { ...d, mapped: true, ...(resolvedMood ? { moodWord: resolvedMood } : {}) }
                : d
            ),
            nodes: [
              ...prev.nodes,
              ...nodesToCreate.map((n) => ({
                ...n,
                ownerId: 'guest',
                mapId: targetMap.id,
              })),
            ],
            edges: [
              ...prev.edges,
              ...edgesToCreate.map((e) => ({
                ...e,
                ownerId: 'guest',
                mapId: targetMap.id,
              })),
            ],
            maps: data.companionNote
              ? prev.maps.map((m) =>
                  m.id === targetMap.id
                    ? {
                        ...m,
                        encouragementTitle: data.companionNote.title,
                        encouragementNote: data.companionNote.message,
                        encouragementStep: data.companionNote.tinyStep,
                      }
                    : m
                )
              : prev.maps,
          }));
        }

        return true;
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : 'Unable to unpack right now.';
        let displayMsg = rawMsg;
        if (rawMsg.startsWith('{')) {
          try {
            const parsed = JSON.parse(rawMsg) as { error?: string };
            if (parsed.error) displayMsg = parsed.error;
          } catch {
            // keep rawMsg
          }
        }
        setDumpError(displayMsg);
        return false;
      } finally {
        setIsUnpacking(false);
        setUnpackingDumpId(null);
        unpackLockRef.current = false;
      }
    },
    [user, updateGuestSandbox]
  );

  const handleUnpackNewDump = async (rawText: string, moodWord?: string): Promise<boolean> => {
    if (!activeMap || unpackLockRef.current) return false;
    if (!isOnline) {
      setDumpError(
        'You are offline right now — reconnect when ready to automatically organize thoughts onto your map.'
      );
      return false;
    }
    unpackLockRef.current = true;
    setIsUnpacking(true);
    setDumpError(null);
    const dumpId = createSafeId('dump');

    if (user) {
      try {
        await createBrainDump(user.uid, activeMap.id, {
          id: dumpId,
          rawText,
          mapped: false,
          moodWord,
        });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : 'Unable to save journal entry right now.';
        setDumpError(msg);
        setIsUnpacking(false);
        unpackLockRef.current = false;
        return false;
      }
    } else {
      const guestDump: BrainDump = {
        id: dumpId,
        ownerId: 'guest',
        mapId: activeMap.id,
        rawText,
        mapped: false,
        moodWord,
      };
      updateGuestSandbox((prev) => ({
        ...prev,
        dumps: [guestDump, ...prev.dumps],
      }));
    }

    return await runUnpackDump(dumpId, rawText, moodWord, activeMap, currentNodes);
  };

  const handleUnpackExistingDump = async (dump: BrainDump) => {
    if (!activeMap || unpackLockRef.current) return;
    if (!isOnline) {
      setDumpError(
        'You are offline right now — reconnect when ready to retry organizing this entry.'
      );
      return;
    }
    unpackLockRef.current = true;
    setUnpackingDumpId(dump.id);
    await runUnpackDump(dump.id, dump.rawText, dump.moodWord, activeMap, currentNodes);
  };

  const handleDeleteDump = async (dumpId: string) => {
    if (!activeMap) return;
    const targetDump = currentDumps.find((d) => d.id === dumpId);
    const linkedNodes = currentNodes.filter((n) => n.sourceDumpId === dumpId);
    const linkedNodeIds = linkedNodes.map((n) => n.id);
    const linkedNodeSet = new Set(linkedNodeIds);

    const linkedEdges = currentEdges.filter(
      (e) => linkedNodeSet.has(e.fromId) || linkedNodeSet.has(e.toId)
    );
    const linkedEdgeIds = linkedEdges.map((e) => e.id);

    const { patternUpdates, patternDeleteIds } = buildPatternCascadeForDeletedNodes(
      currentPatterns,
      linkedNodeSet
    );
    const deletedPatterns = currentPatterns.filter((p) => patternDeleteIds.includes(p.id));
    const prevUpdatedPatterns = currentPatterns
      .filter((p) => patternUpdates.some((u) => u.id === p.id))
      .map((p) => ({ id: p.id, relatedNodeIds: [...p.relatedNodeIds] }));

    if (activePatternId && patternDeleteIds.includes(activePatternId)) {
      setActivePatternId(null);
    }

    if (user) {
      await deleteBrainDump(user.uid, activeMap.id, dumpId, {
        nodeIds: linkedNodeIds,
        edgeIds: linkedEdgeIds,
        patternUpdates,
        patternDeleteIds,
      });
    } else {
      const edgeSet = new Set(linkedEdgeIds);
      const delPatSet = new Set(patternDeleteIds);
      const patUpdateMap = new Map(patternUpdates.map((u) => [u.id, u.remainingNodeIds]));
      updateGuestSandbox((prev) => ({
        ...prev,
        dumps: prev.dumps.filter((d) => d.id !== dumpId),
        nodes: prev.nodes.filter((n) => !linkedNodeSet.has(n.id)),
        edges: prev.edges.filter((e) => !edgeSet.has(e.id)),
        patterns: prev.patterns
          .filter((p) => !delPatSet.has(p.id))
          .map((p) =>
            patUpdateMap.has(p.id)
              ? { ...p, relatedNodeIds: patUpdateMap.get(p.id)! }
              : p
          ),
      }));
    }

    if (targetDump) {
      const extra =
        linkedNodes.length > 0
          ? ` & ${linkedNodes.length} card${linkedNodes.length === 1 ? '' : 's'}`
          : '';
      setPendingUndo({
        id: createSafeId('undo'),
        label: `Removed Journal entry${extra}`,
        mapId: activeMap.id,
        nodes: linkedNodes,
        edges: linkedEdges,
        dumps: [targetDump],
        createdPatterns: deletedPatterns,
        updatedPatterns: prevUpdatedPatterns,
      });
    }
  };

  // --- Mind Map Node & Edge Handlers ---
  const handleCreateNode = async (input: {
    text: string;
    note?: string;
    x: number;
    y: number;
    kind?: NodeKind;
    priorityTier?: PriorityTier;
    connectToNodeId?: string;
  }) => {
    if (!activeMap) return;
    const maxOrder = currentNodes.reduce((m, n) => Math.max(m, n.priorityOrder), 0);
    const nodeId = createSafeId('node');

    if (user) {
      await createMapNode(user.uid, activeMap.id, {
        id: nodeId,
        text: input.text,
        note: input.note || '',
        kind: input.kind || 'thought',
        priorityTier: input.priorityTier || 'none',
        priorityOrder: maxOrder + 1,
        completed: false,
        x: input.x,
        y: input.y,
      });
      if (input.connectToNodeId && currentNodes.some((n) => n.id === input.connectToNodeId)) {
        await createMapEdge(user.uid, activeMap.id, {
          id: createSafeId('edge'),
          fromId: input.connectToNodeId,
          toId: nodeId,
          label: 'connects to',
        });
      }
    } else {
      const newNode: MapNode = {
        id: nodeId,
        ownerId: 'guest',
        mapId: activeMap.id,
        text: input.text,
        note: input.note || '',
        kind: input.kind || 'thought',
        priorityTier: input.priorityTier || 'none',
        priorityOrder: maxOrder + 1,
        completed: false,
        x: input.x,
        y: input.y,
      };
      const newEdge: MapEdge | null =
        input.connectToNodeId && currentNodes.some((n) => n.id === input.connectToNodeId)
          ? {
              id: createSafeId('edge'),
              ownerId: 'guest',
              mapId: activeMap.id,
              fromId: input.connectToNodeId,
              toId: nodeId,
              label: 'connects to',
            }
          : null;
      updateGuestSandbox((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: newEdge ? [...prev.edges, newEdge] : prev.edges,
      }));
    }
  };

  const handleUpdateNode = async (
    nodeId: string,
    updates: Partial<
      Pick<
        MapNode,
        'text' | 'note' | 'kind' | 'theme' | 'priorityTier' | 'priorityOrder' | 'completed' | 'x' | 'y'
      >
    >
  ) => {
    if (!activeMap) return;
    if (user) {
      await updateMapNode(user.uid, activeMap.id, nodeId, updates);
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
      }));
    }
  };

  const handleToggleComplete = async (node: MapNode) => {
    if (!activeMap) return;
    const nextCompleted = !node.completed;
    await handleUpdateNode(node.id, { completed: nextCompleted });

    const nowMs = Date.now();
    if (nextCompleted && isOnline && nowMs - lastAutoCelebrateAtRef.current > 2 * 60 * 1000) {
      lastAutoCelebrateAtRef.current = nowMs;
      try {
        const res = await fetch('/api/ai/encourage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trigger: 'completed',
            focusNodeText: node.text,
            completedCount: currentNodes.filter((n) => n.completed).length + 1,
            nowCount: currentNodes.filter((n) => n.priorityTier === 'now' && !n.completed).length,
            nodesSummary: currentNodes.map((n) => n.text),
            mapTitle: activeMap.title,
          }),
        });
        if (res.ok) {
          const companionNote = (await res.json()) as CompanionNote;
          if (user) {
            await updateMindMapDetails(user.uid, activeMap.id, { companionNote });
          } else {
            updateGuestSandbox((prev) => ({
              ...prev,
              maps: prev.maps.map((m) =>
                m.id === activeMap.id
                  ? {
                      ...m,
                      encouragementTitle: companionNote.title,
                      encouragementNote: companionNote.message,
                      encouragementStep: companionNote.tinyStep,
                    }
                  : m
              ),
            }));
          }
        }
      } catch {
        // Non-blocking gentle celebration
      }
    }
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!activeMap) return;
    const targetNode = currentNodes.find((n) => n.id === nodeId);
    const connectedEdges = currentEdges.filter((e) => e.fromId === nodeId || e.toId === nodeId);
    const connectedEdgeIds = connectedEdges.map((e) => e.id);

    const patternCascade = buildPatternCascadeForDeletedNodes(currentPatterns, new Set([nodeId]));
    const deletedPatterns = currentPatterns.filter((p) =>
      patternCascade.patternDeleteIds.includes(p.id)
    );
    const prevUpdatedPatterns = currentPatterns
      .filter((p) => patternCascade.patternUpdates.some((u) => u.id === p.id))
      .map((p) => ({ id: p.id, relatedNodeIds: [...p.relatedNodeIds] }));

    if (activePatternId && patternCascade.patternDeleteIds.includes(activePatternId)) {
      setActivePatternId(null);
    }

    if (user) {
      await deleteMapNode(user.uid, activeMap.id, nodeId, connectedEdgeIds, patternCascade);
    } else {
      const edgeSet = new Set(connectedEdgeIds);
      const delPatSet = new Set(patternCascade.patternDeleteIds);
      const patUpdateMap = new Map(
        patternCascade.patternUpdates.map((u) => [u.id, u.remainingNodeIds])
      );
      updateGuestSandbox((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => !edgeSet.has(e.id)),
        patterns: prev.patterns
          .filter((p) => !delPatSet.has(p.id))
          .map((p) =>
            patUpdateMap.has(p.id)
              ? { ...p, relatedNodeIds: patUpdateMap.get(p.id)! }
              : p
          ),
      }));
    }

    if (targetNode) {
      const snippet =
        targetNode.text.length > 36 ? `${targetNode.text.slice(0, 36)}...` : targetNode.text;
      setPendingUndo({
        id: createSafeId('undo'),
        label: `Removed "${snippet}"`,
        mapId: activeMap.id,
        nodes: [targetNode],
        edges: connectedEdges,
        dumps: [],
        createdPatterns: deletedPatterns,
        updatedPatterns: prevUpdatedPatterns,
      });
    }
  };

  const handleCreateEdge = async (fromId: string, toId: string, label?: string) => {
    if (!activeMap) return;
    const duplicate = currentEdges.some(
      (e) => (e.fromId === fromId && e.toId === toId) || (e.fromId === toId && e.toId === fromId)
    );
    if (duplicate) return;

    const edgeId = createSafeId('edge');
    if (user) {
      await createMapEdge(user.uid, activeMap.id, {
        id: edgeId,
        fromId,
        toId,
        label: label || 'connects to',
      });
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: edgeId,
            ownerId: 'guest',
            mapId: activeMap.id,
            fromId,
            toId,
            label: label || 'connects to',
          },
        ],
      }));
    }
  };

  const handleUpdateEdge = async (edgeId: string, label: string) => {
    if (!activeMap) return;
    if (user) {
      await updateMapEdge(user.uid, activeMap.id, edgeId, label);
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        edges: prev.edges.map((e) =>
          e.id === edgeId ? { ...e, label: label.trim() || 'connects to' } : e
        ),
      }));
    }
  };

  const handleDeleteEdge = async (edgeId: string) => {
    if (!activeMap) return;
    const targetEdge = currentEdges.find((e) => e.id === edgeId);
    if (user) {
      await deleteMapEdge(user.uid, activeMap.id, edgeId);
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== edgeId),
      }));
    }
    if (targetEdge) {
      setPendingUndo({
        id: createSafeId('undo'),
        label: `Removed thread "${targetEdge.label || 'connects to'}"`,
        mapId: activeMap.id,
        nodes: [],
        edges: [targetEdge],
        dumps: [],
        createdPatterns: [],
        updatedPatterns: [],
      });
    }
  };

  const handleUndoDelete = async () => {
    if (!pendingUndo || undoLockRef.current) return;
    const snapshot = pendingUndo;
    undoLockRef.current = true;
    setIsUndoing(true);
    setPendingUndo(null);

    try {
      if (user) {
        await restoreDeletedBundle(user.uid, snapshot.mapId, snapshot);
        if (activeMapId !== snapshot.mapId) {
          preferredMapIdRef.current = snapshot.mapId;
          setActiveMapId(snapshot.mapId);
          await updateActiveMapId(user.uid, snapshot.mapId);
        }
      } else {
        const ownerId = 'guest';
        const patRevertMap = new Map(
          snapshot.updatedPatterns.map((p) => [p.id, p.relatedNodeIds])
        );
        updateGuestSandbox((prev) => {
          const existingDumpIds = new Set(prev.dumps.map((d) => d.id));
          const existingNodeIds = new Set(prev.nodes.map((n) => n.id));
          const existingEdgeIds = new Set(prev.edges.map((e) => e.id));
          const existingPatIds = new Set(prev.patterns.map((p) => p.id));

          return {
            ...prev,
            activeMapId: prev.maps.some((m) => m.id === snapshot.mapId)
              ? snapshot.mapId
              : prev.activeMapId,
            dumps: [
              ...snapshot.dumps
                .filter((d) => !existingDumpIds.has(d.id))
                .map((d) => ({ ...d, ownerId, mapId: snapshot.mapId })),
              ...prev.dumps,
            ],
            nodes: [
              ...prev.nodes,
              ...snapshot.nodes
                .filter((n) => !existingNodeIds.has(n.id))
                .map((n) => ({ ...n, ownerId, mapId: snapshot.mapId })),
            ],
            edges: [
              ...prev.edges,
              ...snapshot.edges
                .filter((e) => !existingEdgeIds.has(e.id))
                .map((e) => ({ ...e, ownerId, mapId: snapshot.mapId })),
            ],
            patterns: [
              ...prev.patterns.map((p) =>
                patRevertMap.has(p.id)
                  ? { ...p, relatedNodeIds: patRevertMap.get(p.id)! }
                  : p
              ),
              ...snapshot.createdPatterns
                .filter((p) => !existingPatIds.has(p.id))
                .map((p) => ({ ...p, ownerId, mapId: snapshot.mapId })),
            ],
          };
        });
      }
    } finally {
      undoLockRef.current = false;
      setIsUndoing(false);
    }
  };

  const handleBranchNode = async (parentNode: MapNode): Promise<string | null> => {
    if (!activeMap) return null;
    const pos = computeBranchPosition(parentNode, currentNodes);
    const maxOrder = currentNodes.reduce((m, n) => Math.max(m, n.priorityOrder), 0);
    const newNodeId = createSafeId('node');
    const newEdgeId = createSafeId('edge');
    const newText = `Follow-up to "${parentNode.text.slice(0, 32)}${parentNode.text.length > 32 ? '...' : ''}"`;

    if (user) {
      await createBranchedNode(
        user.uid,
        activeMap.id,
        {
          id: newNodeId,
          text: newText,
          kind: 'thought',
          priorityTier: 'none',
          priorityOrder: maxOrder + 1,
          completed: false,
          theme: parentNode.theme || '',
          x: pos.x,
          y: pos.y,
        },
        {
          id: newEdgeId,
          fromId: parentNode.id,
          toId: newNodeId,
          label: 'branches into',
        }
      );
    } else {
      updateGuestSandbox((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id: newNodeId,
            ownerId: 'guest',
            mapId: activeMap.id,
            text: newText,
            kind: 'thought',
            priorityTier: 'none',
            priorityOrder: maxOrder + 1,
            completed: false,
            theme: parentNode.theme || '',
            x: pos.x,
            y: pos.y,
          },
        ],
        edges: [
          ...prev.edges,
          {
            id: newEdgeId,
            ownerId: 'guest',
            mapId: activeMap.id,
            fromId: parentNode.id,
            toId: newNodeId,
            label: 'branches into',
          },
        ],
      }));
    }
    return newNodeId;
  };

  const handleAutoArrange = async () => {
    if (!activeMap || currentNodes.length === 0) return;
    const positions = computeArrangedPositions(currentNodes);
    if (user) {
      await batchUpdateNodePositions(user.uid, activeMap.id, positions);
    } else {
      const posMap = new Map(positions.map((p) => [p.id, p]));
      updateGuestSandbox((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const p = posMap.get(n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        }),
      }));
    }
  };

  // --- Pattern Finder & Wise Companion Handlers ---
  const handleFindPatterns = async () => {
    if (!activeMap) return;
    setAiError(null);

    const lastFingerprint = lastPatternFingerprintRef.current[activeMap.id];
    const thoughtsChangedSinceScan =
      typeof lastFingerprint === 'string' && lastFingerprint !== patternContentFingerprint;

    if (currentPatterns.length > 0 && !thoughtsChangedSinceScan) {
      const currentIdx = currentPatterns.findIndex((p) => p.id === activePatternId);
      if (currentIdx === -1) {
        setActivePatternId(currentPatterns[0].id);
        return;
      }
      if (currentIdx + 1 < currentPatterns.length) {
        setActivePatternId(currentPatterns[currentIdx + 1].id);
        return;
      }
      if (!isOnline && currentPatterns.length > 1) {
        setActivePatternId(currentPatterns[0].id);
        return;
      }
    }

    if (!isOnline) {
      setAiError('You are offline right now — Pattern Finder will be ready once your connection returns.');
      return;
    }
    setPendingUndo(null);
    setIsFindingPatterns(true);
    try {
      const res = await fetch('/api/ai/find-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapTitle: activeMap.title,
          intention: activeMap.intention || '',
          excludeTitles: currentPatterns.map((p) => p.title),
          nodes: currentNodes.map((n) => ({
            id: n.id,
            text: n.text,
            kind: n.kind,
            priorityTier: n.priorityTier,
            completed: n.completed,
            theme: n.theme,
          })),
          dumps: currentDumps.map((d) => ({
            rawText: d.rawText,
            moodWord: d.moodWord,
          })),
        }),
      });

      const data = (await res.json()) as FindPatternsResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Could not analyze patterns.');
      }

      const validNodeSet = new Set(currentNodes.map((n) => n.id));
      const formatted = (data.patterns || []).map((p) => ({
        id: createSafeId('pat'),
        title: p.title,
        insight: p.insight,
        tone: sanitizeTone(p.tone),
        relatedNodeIds: (p.relatedNodeIds || []).filter((id) => validNodeSet.has(id)),
      }));

      lastPatternFingerprintRef.current[activeMap.id] = patternContentFingerprint;

      if (user) {
        await replacePatterns(
          user.uid,
          activeMap.id,
          currentPatterns.map((p) => p.id),
          formatted
        );
        if (data.companionNote) {
          await updateMindMapDetails(user.uid, activeMap.id, {
            companionNote: data.companionNote,
          });
        }
      } else {
        updateGuestSandbox((prev) => ({
          ...prev,
          patterns: [
            ...prev.patterns.filter((p) => p.mapId !== activeMap.id),
            ...formatted.map((p) => ({
              ...p,
              ownerId: 'guest',
              mapId: activeMap.id,
            })),
          ],
          maps: data.companionNote
            ? prev.maps.map((m) =>
                m.id === activeMap.id
                  ? {
                      ...m,
                      encouragementTitle: data.companionNote.title,
                      encouragementNote: data.companionNote.message,
                      encouragementStep: data.companionNote.tinyStep,
                    }
                  : m
              )
            : prev.maps,
        }));
      }

      if (formatted.length > 0) {
        setActivePatternId(formatted[0].id);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to discover patterns right now.';
      setAiError(msg);
    } finally {
      setIsFindingPatterns(false);
    }
  };

  const handleAskCompanion = async (trigger: 'ground' | 'self-care' | 'letting-go') => {
    if (!activeMap) return;
    if (!isOnline) {
      setAiError('You are offline right now — the companion will be ready once your connection returns.');
      return;
    }
    setAiError(null);
    setIsAskingCompanion(true);
    try {
      const res = await fetch('/api/ai/encourage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger,
          focusNodeText:
            currentNodes.find((n) => n.priorityTier === 'now' && !n.completed)?.text || '',
          completedCount: currentNodes.filter((n) => n.completed).length,
          nowCount: currentNodes.filter((n) => n.priorityTier === 'now' && !n.completed).length,
          nodesSummary: currentNodes.map((n) => n.text),
          mapTitle: activeMap.title,
        }),
      });
      const data = (await res.json()) as CompanionNote & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Unable to reach companion.');
      }

      if (user) {
        await updateMindMapDetails(user.uid, activeMap.id, { companionNote: data });
      } else {
        updateGuestSandbox((prev) => ({
          ...prev,
          maps: prev.maps.map((m) =>
            m.id === activeMap.id
              ? {
                  ...m,
                  encouragementTitle: data.title,
                  encouragementNote: data.message,
                  encouragementStep: data.tinyStep,
                }
              : m
          ),
        }));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to reach companion right now.';
      setAiError(msg);
    } finally {
      setIsAskingCompanion(false);
    }
  };

  const handleSelectPattern = (pattern: PatternInsight) => {
    setActivePatternId((prev) => (prev === pattern.id ? null : pattern.id));
  };

  const handleSpotlightOnMap = (pattern: PatternInsight) => {
    setActivePatternId(pattern.id);
    setMobileSection('map');
  };

  const unfinishedTodayNodes = useMemo(
    () => currentNodes.filter((n) => n.priorityTier === 'now' && !n.completed),
    [currentNodes]
  );

  const dismissDailyReturnCue = useCallback(() => {
    const today = getLocalDayKey();
    saveDailyCheckInState({ lastSeenDay: today, dismissedForDay: today });
    setIsNewDayReturn(false);
  }, []);

  const handleEaseTodayToLater = async () => {
    if (isEasingTodayCards || unfinishedTodayNodes.length === 0) {
      dismissDailyReturnCue();
      return;
    }
    setIsEasingTodayCards(true);
    try {
      await Promise.all(
        unfinishedTodayNodes.map((n) => handleUpdateNode(n.id, { priorityTier: 'later' }))
      );
      dismissDailyReturnCue();
    } finally {
      setIsEasingTodayCards(false);
    }
  };

  const isLoadingCloudWorkspace =
    Boolean(user) && (isMigratingGuest || !mapsLoaded || !activeMap);

  return (
    <div className="min-h-screen h-screen flex flex-col bg-[#F4ECE0] text-[#2B2118]">
      <TopBar
        userName={user?.displayName || user?.email}
        activeSection={mobileSection}
        onSelectSection={setMobileSection}
        onOpenSanctuaries={() => setSanctuariesOpen(true)}
        onSignOut={() => void handleSignOut()}
        onSignIn={() => void handleSignIn()}
        isSignedIn={Boolean(user)}
      />

      <SensoryBar />

      {/* Gentle Local Sandbox Banner when visiting without signing in */}
      {authReady && isGuestMode && activeMap && (
        <div className="shrink-0 bg-[#EFE8DA] border-b border-[#DDD1BD] px-4 md:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0 text-[#635345]">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                guestState.hasInteracted ? 'bg-[#C48A47]' : 'bg-[#5F735D]'
              }`}
              aria-hidden="true"
            />
            <span className="leading-snug">
              {guestState.hasInteracted
                ? 'Your changes are saved in this browser only.'
                : 'Local sandbox — write in your Journal, drag a card into Today, or explore freely.'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {authError && (
              <div className="inline-flex flex-wrap items-center gap-2 text-[11px] text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded px-2.5 py-1 max-w-[440px]">
                <span className="leading-snug flex-1 min-w-[160px]">{authError}</span>
                {authOfferRedirect && (
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={() => void handleRedirectSignIn()}
                    className="underline underline-offset-2 font-semibold text-[#5F735D] hover:text-[#2B2118] shrink-0"
                  >
                    Try redirect sign-in
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAuthError(null);
                    setAuthOfferRedirect(false);
                  }}
                  aria-label="Dismiss sign-in message"
                  className="text-[#8F472B] hover:text-[#2B2118] shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <button
              type="button"
              aria-expanded={privacyNoteOpen}
              onClick={() => setPrivacyNoteOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#635345] hover:text-[#2B2118] underline underline-offset-2 whitespace-nowrap shrink-0"
            >
              <Lock className="w-3 h-3 text-[#5F735D]" />
              <span>How your words &amp; voice are handled</span>
            </button>

            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={authLoading}
              aria-label="Sign in with Google to keep this Sanctuary & sync across devices"
              className="px-2.5 sm:px-3 py-1 text-[11px] font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C] disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {authLoading ? (
                'Signing in...'
              ) : (
                <>
                  <span>Sign in with Google</span>
                  <span className="hidden sm:inline"> to keep this Sanctuary &amp; sync across devices</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {authReady && isGuestMode && activeMap && privacyNoteOpen && (
        <div
          role="region"
          aria-label="How your words and voice are handled"
          className="shrink-0 bg-[#FBF6EC] border-b border-[#DDD1BD] px-4 md:px-5 py-2.5 flex items-start justify-between gap-4 text-xs text-[#635345]"
        >
          <div className="space-y-1 max-w-4xl">
            <p className="font-semibold text-[#2B2118]">How your words &amp; voice are handled</p>
            <p className="leading-relaxed">
              <strong className="font-medium text-[#2B2118]">Your words stay yours:</strong> In this local sandbox, notes live only in your browser. Signing in with Google moves them cleanly to your private account—never shared, sold, or used for ads.
            </p>
            <p className="leading-relaxed">
              <strong className="font-medium text-[#2B2118]">Voice &amp; AI only run on click:</strong> Voice recordings are transcribed into text once and immediately discarded (never stored as audio files). Export as <span className="font-mono-tabular">.json</span> or Markdown or delete any entry anytime in <strong className="font-medium text-[#2B2118]">Sanctuaries</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPrivacyNoteOpen(false)}
            aria-label="Close privacy note"
            className="p-1 text-[#8C7A68] hover:text-[#2B2118] shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quiet Offline Resilience Banner (only shown if browser loses connection) */}
      {!isOnline && !offlineBannerDismissed && activeMap && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 bg-[#F7E9E2] border-b border-[#DFB6A5] px-4 md:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#635345]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-3.5 h-3.5 text-[#B86B4B] shrink-0" />
            <span className="leading-snug">
              Connection paused — keep writing freely. Your thoughts stay saved locally
              {user ? ' and will sync once you reconnect' : ''}.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                exportSanctuaryAsJson({
                  map: activeMap,
                  nodes: currentNodes,
                  edges: currentEdges,
                  dumps: currentDumps,
                  patterns: currentPatterns,
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#2B2118] bg-[#FBF6EC] border border-[#DFB6A5] rounded hover:bg-[#EFE8DA] transition-colors whitespace-nowrap"
            >
              <Download className="w-3 h-3" />
              <span>Save backup (.json)</span>
            </button>
            <button
              type="button"
              onClick={() => setOfflineBannerDismissed(true)}
              aria-label="Dismiss offline notice"
              className="p-1 text-[#8F472B] hover:text-[#2B2118]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Gentle Daily Return Prompt (only shown on a new day with unfinished Today cards) */}
      {authReady &&
        isNewDayReturn &&
        activeMap &&
        unfinishedTodayNodes.length > 0 && (
          <div
            role="region"
            aria-label="Daily gentle check-in"
            className="shrink-0 bg-[#FBF6EC] border-b border-[#DDD1BD] px-4 md:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#635345]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Sunrise className="w-3.5 h-3.5 text-[#C48A47] shrink-0" />
              <span className="leading-snug">
                A new day —{' '}
                <strong className="font-medium text-[#2B2118]">
                  {unfinishedTodayNodes.length} unfinished Today{' '}
                  {unfinishedTodayNodes.length === 1 ? 'card' : 'cards'}
                </strong>{' '}
                from an earlier visit. Keep them for today, or ease them into Later without guilt?
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isEasingTodayCards}
                onClick={() => void handleEaseTodayToLater()}
                className="px-2.5 py-1 text-[11px] font-medium text-[#635345] bg-[#EFE8DA] border border-[#DDD1BD] rounded hover:bg-[#E4DAC7] hover:text-[#2B2118] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isEasingTodayCards ? 'Moving...' : 'Ease into Later'}
              </button>
              <button
                type="button"
                disabled={isEasingTodayCards}
                onClick={dismissDailyReturnCue}
                className="px-2.5 py-1 text-[11px] font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                Keep for Today
              </button>
              <button
                type="button"
                onClick={dismissDailyReturnCue}
                aria-label="Dismiss daily check-in"
                className="p-1 text-[#8C7A68] hover:text-[#2B2118]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

      {!authReady ? (
        <main className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[#635345]">Preparing your quiet desk...</p>
        </main>
      ) : isLoadingCloudWorkspace || !activeMap ? (
        <main className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[#635345]">
            {isMigratingGuest
              ? 'Saving your Sanctuary to your account...'
              : 'Opening your thinking sanctuary...'}
          </p>
        </main>
      ) : (
        <>
          <div className="md:hidden shrink-0 border-b border-[#DDD1BD] bg-[#FBF6EC] px-4 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-[#E4DAC7] p-0.5 rounded-md">
              {(
                [
                  { id: 'patterns', label: 'Nourishment' },
                  { id: 'dump', label: 'Journal' },
                  { id: 'map', label: 'Mind Map' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMobileSection(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    mobileSection === tab.id
                      ? 'bg-[#FBF6EC] text-[#2B2118]'
                      : 'text-[#635345]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSanctuariesOpen(true)}
              className="text-xs font-medium text-[#5F735D] underline underline-offset-2"
            >
              Sanctuaries
            </button>
          </div>

          <main className="flex-1 min-h-0 flex overflow-hidden">
            {mobileSection === 'map' && (
              <MindMapCanvas
                activeMap={activeMap}
                nodes={currentNodes}
                edges={currentEdges}
                highlightedNodeIds={activePattern ? activePattern.relatedNodeIds : null}
                activePatternTitle={activePattern ? activePattern.title : null}
                onClearPatternSpotlight={() => setActivePatternId(null)}
                onUpdateMapDetails={handleUpdateMapDetails}
                onCreateNode={handleCreateNode}
                onBranchNode={handleBranchNode}
                onUpdateNode={handleUpdateNode}
                onToggleComplete={handleToggleComplete}
                onDeleteNode={handleDeleteNode}
                onCreateEdge={handleCreateEdge}
                onUpdateEdge={handleUpdateEdge}
                onDeleteEdge={handleDeleteEdge}
                onAutoArrange={handleAutoArrange}
              />
            )}

            {mobileSection === 'dump' && (
              <BrainDumpRail
                dumps={currentDumps}
                isOnline={isOnline}
                isUnpacking={isUnpacking}
                unpackingDumpId={unpackingDumpId}
                onUnpackNewDump={handleUnpackNewDump}
                onUnpackExistingDump={handleUnpackExistingDump}
                onDeleteDump={handleDeleteDump}
                errorMessage={dumpError}
              />
            )}

            {mobileSection === 'patterns' && (
              <CompanionAndPatternsRail
                activeMap={activeMap}
                nodes={currentNodes}
                patterns={currentPatterns}
                activePatternId={activePatternId}
                completedCount={currentNodes.filter((n) => n.completed).length}
                dumpCount={currentDumps.length}
                onBreathComplete={handleBreathComplete}
                onWaterPlant={handleWaterPlant}
                onResetPlant={handleResetPlant}
                onSelectPattern={handleSelectPattern}
                onSpotlightOnMap={handleSpotlightOnMap}
                onFindPatterns={handleFindPatterns}
                onAskCompanion={handleAskCompanion}
                isFindingPatterns={isFindingPatterns}
                isAskingCompanion={isAskingCompanion}
                aiError={aiError}
              />
            )}
          </main>

          {sanctuariesOpen && (
            <SanctuariesModal
              maps={currentMaps}
              activeMapId={currentActiveMapId}
              activeMap={activeMap}
              activeNodes={currentNodes}
              activeEdges={currentEdges}
              activeDumps={currentDumps}
              activePatterns={currentPatterns}
              isSignedIn={Boolean(user)}
              onFetchSearchIndex={handleFetchSearchIndex}
              onSelectMap={(id) => void handleSelectMap(id)}
              onCreateMap={handleCreateMap}
              onImportBundle={handleImportBundle}
              onDeleteMap={handleDeleteMap}
              onClose={() => setSanctuariesOpen(false)}
            />
          )}
        </>
      )}

      {pendingUndo && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] bg-[#2B2118] text-[#FBF6EC] border border-[#635345] rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 text-xs"
        >
          <span className="truncate max-w-[240px] sm:max-w-[360px]">{pendingUndo.label}</span>
          <button
            type="button"
            disabled={isUndoing}
            onClick={() => void handleUndoDelete()}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#5F735D] hover:bg-[#4E604C] text-[#FBF6EC] font-medium shrink-0 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{isUndoing ? 'Restoring...' : 'Undo'}</span>
          </button>
          <button
            type="button"
            onClick={() => setPendingUndo(null)}
            aria-label="Dismiss notification"
            className="p-0.5 text-[#D8CBB8] hover:text-[#FBF6EC] shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
