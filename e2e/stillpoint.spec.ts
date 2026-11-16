import { expect, test, type Page } from '@playwright/test';
import type { BrainDump, MapEdge, MapNode, MindMap, PatternInsight } from '../src/types';

async function installVoiceRecordingMock(page: Page, options?: { denyMic?: boolean }) {
  const denyMic = Boolean(options?.denyMic);
  await page.addInitScript((shouldDeny: boolean) => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (shouldDeny) {
            throw new DOMException('Permission denied', 'NotAllowedError');
          }
          return fakeStream;
        },
      },
    });

    class MockMediaRecorder {
      public state: 'inactive' | 'recording' = 'inactive';
      public mimeType = 'audio/webm';
      public ondataavailable: ((event: { data: Blob }) => void) | null = null;
      public onstop: (() => void) | null = null;
      public onerror: (() => void) | null = null;

      static isTypeSupported(mime: string) {
        return mime.startsWith('audio/webm');
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        const sampleBytes = new Uint8Array(1024);
        sampleBytes.fill(42);
        const blob = new Blob([sampleBytes], { type: 'audio/webm' });
        this.ondataavailable?.({ data: blob });
        this.onstop?.();
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    });
  }, denyMic);
}

async function installCloudMigrationMock(page: Page) {
  await page.addInitScript(() => {
    interface StoredBundle {
      map: MindMap;
      nodes: MapNode[];
      edges: MapEdge[];
      dumps: BrainDump[];
      patterns: PatternInsight[];
    }

    let currentUser: { uid: string; displayName: string | null; email: string | null } | null = null;
    const authListeners = new Set<(user: typeof currentUser) => void>();
    const mapListeners = new Set<(maps: MindMap[]) => void>();
    const mapDataListeners = new Map<
      string,
      Set<
        (data: {
          nodes: MapNode[];
          edges: MapEdge[];
          dumps: BrainDump[];
          patterns: PatternInsight[];
        }) => void
      >
    >();
    const bundles = new Map<string, StoredBundle>();

    const notifyMaps = () => {
      const allMaps = Array.from(bundles.values()).map((b) => b.map);
      for (const listener of mapListeners) {
        listener(allMaps);
      }
    };

    const notifyMapData = (mapId: string) => {
      const bundle = bundles.get(mapId);
      const listeners = mapDataListeners.get(mapId);
      if (!bundle || !listeners) return;
      for (const listener of listeners) {
        listener({
          nodes: bundle.nodes,
          edges: bundle.edges,
          dumps: bundle.dumps,
          patterns: bundle.patterns,
        });
      }
    };

    window.__STILLPOINT_TEST_ADAPTER__ = {
      onAuthStateChanged(cb) {
        authListeners.add(cb);
        queueMicrotask(() => cb(currentUser));
        return () => authListeners.delete(cb);
      },
      async signInWithPopup() {
        currentUser = {
          uid: 'e2e_user_maya',
          displayName: 'Maya Lin',
          email: 'maya@example.com',
        };
        for (const cb of authListeners) cb(currentUser);
      },
      async signOut() {
        currentUser = null;
        for (const cb of authListeners) cb(null);
      },
      async importGuestSanctuaryBundle(uid, bundle) {
        const importedMapId = `cloud_${bundle.map.id}`;
        const importedNodes = bundle.nodes.map((n) => ({
          ...n,
          ownerId: uid,
          mapId: importedMapId,
        }));
        const importedEdges = bundle.edges.map((e) => ({
          ...e,
          ownerId: uid,
          mapId: importedMapId,
        }));
        const importedDumps = bundle.dumps.map((d) => ({
          ...d,
          ownerId: uid,
          mapId: importedMapId,
        }));
        const importedPatterns = bundle.patterns.map((p) => ({
          ...p,
          ownerId: uid,
          mapId: importedMapId,
        }));

        bundles.set(importedMapId, {
          map: { ...bundle.map, id: importedMapId, ownerId: uid },
          nodes: importedNodes,
          edges: importedEdges,
          dumps: importedDumps,
          patterns: importedPatterns,
        });
        notifyMaps();
        notifyMapData(importedMapId);
        return importedMapId;
      },
      async updateActiveMapId() {
        // No-op in memory store
      },
      subscribeMaps(_uid, cb) {
        mapListeners.add(cb);
        cb(Array.from(bundles.values()).map((b) => b.map));
        return () => mapListeners.delete(cb);
      },
      subscribeMapData(_uid, mapId, cb) {
        let set = mapDataListeners.get(mapId);
        if (!set) {
          set = new Set();
          mapDataListeners.set(mapId, set);
        }
        set.add(cb);
        const existing = bundles.get(mapId);
        if (existing) {
          cb({
            nodes: existing.nodes,
            edges: existing.edges,
            dumps: existing.dumps,
            patterns: existing.patterns,
          });
        }
        return () => set?.delete(cb);
      },
    };
  });
}

test.describe('Sloww E2E Smoke Suite', () => {
  test('Journal voice recording, transcription, and Capture & Organize flow', async ({ page }) => {
    await installVoiceRecordingMock(page);

    let transcribeRequestSeen = false;
    await page.route('**/api/ai/transcribe', async (route) => {
      const payload = route.request().postDataJSON() as {
        audioBase64?: string;
        mimeType?: string;
        durationSeconds?: number;
      };
      expect(payload.audioBase64).toBeTruthy();
      expect(payload.mimeType).toContain('audio/');
      expect(typeof payload.durationSeconds).toBe('number');
      transcribeRequestSeen = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          transcript: 'Protect twenty quiet minutes before answering emails.',
        }),
      });
    });

    await page.route('**/api/ai/unpack-dump', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          moodWord: 'calmly focused',
          extractedNodes: [
            {
              text: 'Take twenty quiet minutes first',
              note: 'Ease into the morning before checking messages.',
              kind: 'anchor',
              suggestedPriority: 'now',
              theme: 'Morning Focus',
            },
          ],
          suggestedLinks: [],
          companionNote: {
            title: 'Start gently',
            message: 'Protecting the first twenty minutes keeps the whole morning steadier.',
            tinyStep: 'Silence notifications for twenty minutes.',
          },
        }),
      });
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/Sloww/);
    await expect(page.getByRole('link', { name: 'Sloww', exact: true })).toBeVisible();
    await expect(page.getByText(/Local sandbox/i)).toBeVisible();

    // Open Journal tab
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();

    // Start recording
    const recordBtn = page.getByRole('button', { name: 'Record', exact: true });
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    await expect(page.getByText('Listening gently... speak at your own pace.')).toBeVisible();
    const stopBtn = page.getByRole('button', { name: 'Stop recording' });
    await expect(stopBtn).toBeVisible();

    // Stop recording -> transcribes into textarea
    await stopBtn.click();
    await expect.poll(() => transcribeRequestSeen).toBe(true);

    const textarea = page.getByPlaceholder(/Empty your head here without editing/i);
    await expect(textarea).toHaveValue('Protect twenty quiet minutes before answering emails.');

    // Capture & Organize adds entry and switches state cleanly
    await page.getByRole('button', { name: /Capture & Organize/i }).click();
    await expect(
      page.getByText('Protect twenty quiet minutes before answering emails.')
    ).toBeVisible();
    await expect(textarea).toHaveValue('');
  });

  test('Journal recording surfaces friendly notice when microphone access is denied', async ({
    page,
  }) => {
    await installVoiceRecordingMock(page, { denyMic: true });

    await page.goto('/');
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Record', exact: true }).click();

    await expect(
      page.getByText(/Microphone permission was declined/i)
    ).toBeVisible();
  });

  test('Canvas zoom controls, wheel zoom, keyboard shortcuts, and card drag + Hearth drop', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Mind Map', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Today's Quiet Clearing" })).toBeVisible();

    // Locate zoom controls in bottom-right
    const zoomResetBtn = page.getByRole('button', { name: 'Reset zoom to 100%' });
    const zoomInBtn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOutBtn = page.getByRole('button', { name: 'Zoom out' });

    await expect(zoomResetBtn).toBeVisible();
    const readZoomPct = async () => {
      const label = (await zoomResetBtn.textContent()) || '';
      return Number.parseInt(label.replace('%', '').trim(), 10);
    };

    const initialZoom = await readZoomPct();
    expect(initialZoom).toBeGreaterThanOrEqual(35);
    expect(initialZoom).toBeLessThanOrEqual(180);

    // Button zoom in & zoom out
    await zoomInBtn.click();
    const afterZoomIn = await readZoomPct();
    expect(afterZoomIn).toBeGreaterThan(initialZoom);

    await zoomOutBtn.click();
    const afterZoomOut = await readZoomPct();
    expect(afterZoomOut).toBeLessThan(afterZoomIn);

    // Reset to 100% by clicking the percentage pill
    await zoomResetBtn.click();
    expect(await readZoomPct()).toBe(100);

    // Keyboard shortcuts (-, +, 0)
    await page.keyboard.press('-');
    expect(await readZoomPct()).toBe(85);
    await page.keyboard.press('+');
    expect(await readZoomPct()).toBe(100);
    await page.keyboard.press('+');
    expect(await readZoomPct()).toBe(115);
    await page.keyboard.press('0');
    expect(await readZoomPct()).toBe(100);

    // Wheel zoom over the canvas
    const canvasViewport = page.locator('.paper-grid').first();
    const canvasBox = await canvasViewport.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.move(canvasBox!.x + 120, canvasBox!.y + 120);
    await page.mouse.wheel(0, -180);
    await expect.poll(readZoomPct).toBeGreaterThan(100);
    await zoomResetBtn.click();
    expect(await readZoomPct()).toBe(100);

    // Show all nodes so we can drag an "Up Next" card into the Hearth ("Today")
    await page.getByRole('button', { name: /Show All \(/i }).click();
    await page.getByRole('button', { name: 'Fit map to screen' }).click();

    const targetCardText = 'Reply to the two open threads waiting on me';
    const card = page.locator('[data-canvas-interactive="true"]', { hasText: targetCardText }).first();
    const hearthHeading = page.getByRole('heading', { name: 'Priority Hearth' });

    const cardBox = await card.boundingBox();
    const hearthBox = await hearthHeading.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(hearthBox).not.toBeNull();

    // Drag card onto the Priority Hearth
    await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + 18);
    await page.mouse.down();
    await page.mouse.move(hearthBox!.x + hearthBox!.width / 2, hearthBox!.y + 110, { steps: 14 });
    await page.mouse.up();

    // Sandbox records interaction & card persists in Today tier across reload
    await expect(page.getByText('Your changes are saved in this browser only.')).toBeVisible();
    const savedState = await page.evaluate(() => {
      const raw = window.localStorage.getItem('stillpoint_guest_sandbox_v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(savedState?.hasInteracted).toBe(true);
    const movedNode = savedState?.nodes?.find((n: { text: string }) => n.text === targetCardText);
    expect(movedNode?.priorityTier).toBe('now');

    await page.reload();
    await expect(page.getByText('Your changes are saved in this browser only.')).toBeVisible();
  });

  test('Sandbox -> Sign-in migration preserves thoughts and clears guest storage', async ({
    page,
  }) => {
    await installCloudMigrationMock(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Mind Map', exact: true }).click();

    // Create a custom card inside the guest sandbox
    await page.getByRole('button', { name: 'Add Card' }).click();
    const addPopover = page.locator('form', { hasText: 'Place a card on the map' });
    await addPopover.getByPlaceholder('Card title or concrete step...').fill('Sketch calm landing page');
    await addPopover.getByRole('button', { name: 'Today', exact: true }).click();
    await addPopover.getByRole('button', { name: 'Add Card', exact: true }).click();

    await expect(page.getByText('Your changes are saved in this browser only.')).toBeVisible();

    const preSignInStorage = await page.evaluate(() =>
      window.localStorage.getItem('stillpoint_guest_sandbox_v1')
    );
    expect(preSignInStorage).toContain('Sketch calm landing page');

    // Trigger sign-in from the sandbox banner
    await page
      .getByRole('button', {
        name: /Sign in with Google to keep this Sanctuary & sync across devices/i,
      })
      .click();

    // Verify TopBar switches to signed-in user, guest banner disappears, and local sandbox clears
    await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible();
    await expect(page.getByText('Maya')).toBeVisible();
    await expect(page.getByText('Your changes are saved in this browser only.')).toHaveCount(0);

    await expect
      .poll(async () =>
        page.evaluate(() => window.localStorage.getItem('stillpoint_guest_sandbox_v1'))
      )
      .toBeNull();

    // Switch to List View and confirm the migrated custom card is intact in the cloud Sanctuary
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByText('Sketch calm landing page').first()).toBeVisible();
  });

  test('Nourishment Breathwork offers 4-6, Box, Psychological Sigh, Humming, and expandable benefits', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nourishment', exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Breathwork' })).toBeVisible();
    await expect(page.getByRole('button', { name: '4–6', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Box', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sigh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Humming', exact: true })).toBeVisible();
    await expect(page.getByText(/4–7–8/)).toHaveCount(0);

    // Expand benefits guide
    const benefitsToggle = page.getByRole('button', { name: /Why each breathwork style helps/i });
    await expect(benefitsToggle).toHaveAttribute('aria-expanded', 'false');
    await benefitsToggle.click();
    await expect(benefitsToggle).toHaveAttribute('aria-expanded', 'true');

    await expect(page.getByText(/re-inflate tiny lung air sacs/i)).toBeVisible();
    await expect(page.getByText(/vibrates the throat and sinuses/i)).toBeVisible();

    // Selecting Psychological Sigh from benefits switches the active cadence
    await page.getByRole('button', { name: /Psychological Sigh/i }).click();
    await expect(page.getByText('Psychological Sigh').first()).toBeVisible();

    // Collapsible 5-4-3-2-1 Sensory Grounding bar at the bottom of Nourishment
    const groundingToggle = page.getByRole('button', { name: /5–4–3–2–1 Sensory Grounding/i });
    await expect(groundingToggle).toBeVisible();
    await expect(groundingToggle).toHaveAttribute('aria-expanded', 'false');
    await groundingToggle.click();
    await expect(groundingToggle).toHaveAttribute('aria-expanded', 'true');

    await expect(page.getByText('Things you can see')).toBeVisible();
    await expect(page.getByText('Thing you can taste')).toBeVisible();
    await page.getByRole('button', { name: 'Thing you can taste 1 of 1' }).click();
    await expect(page.getByText('1/15')).toBeVisible();
  });

  test('Offline resilience notice and gentle daily return cue work cleanly', async ({
    page,
    context,
  }) => {
    // Seed an earlier visit day so the gentle daily return prompt appears
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'stillpoint_daily_checkin_v1',
        JSON.stringify({ lastSeenDay: '2020-01-01', dismissedForDay: '' })
      );
    });

    await page.goto('/');

    // Daily return banner appears for the unfinished Today card
    const dailyBanner = page.getByRole('region', { name: 'Daily gentle check-in' });
    await expect(dailyBanner).toBeVisible();
    await expect(dailyBanner.getByText(/1 unfinished Today card/i)).toBeVisible();

    // Easing Today card into Later dismisses the banner and moves the card gently
    await dailyBanner.getByRole('button', { name: 'Ease into Later' }).click();
    await expect(dailyBanner).toHaveCount(0);

    const movedToLater = await page.evaluate(() => {
      const raw = window.localStorage.getItem('stillpoint_guest_sandbox_v1');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { nodes?: Array<{ priorityTier: string }> };
      return (parsed.nodes || []).every((n) => n.priorityTier !== 'now');
    });
    expect(movedToLater).toBe(true);

    // Offline banner appears when connection drops and clears when restored
    await context.setOffline(true);
    await expect(page.getByText(/Connection paused — keep writing freely/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Save backup/i })).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/Connection paused — keep writing freely/i)).toHaveCount(0);

    // Sound bar atmospheric backdrop (clouds, scattered rain, birds) & sound mode switching remain clickable
    const soundBar = page.getByRole('region', { name: 'Ambient Sound Bar' });
    await expect(soundBar).toBeVisible();
    const atmosphere = soundBar.getByTestId('sensory-atmosphere');
    await expect(atmosphere).toBeVisible();

    const rainTimings = await atmosphere.locator('.sensory-rain-drop').evaluateAll((els) =>
      els.slice(0, 4).map((el) => {
        const cs = window.getComputedStyle(el);
        return { delay: cs.animationDelay, duration: cs.animationDuration };
      })
    );
    expect(new Set(rainTimings.map((t) => t.delay)).size).toBeGreaterThan(1);
    expect(new Set(rainTimings.map((t) => t.duration)).size).toBeGreaterThan(1);

    await soundBar.getByRole('button', { name: 'Faint Rain' }).click();
    await soundBar.getByRole('button', { name: 'Morning Birds' }).click();
    await soundBar.getByRole('button', { name: 'Silence' }).click();
  });

  test('Visible plain-English privacy note toggles cleanly next to Google Sign-In', async ({
    page,
  }) => {
    await page.goto('/');

    const trigger = page.getByRole('button', { name: /How your words & voice are handled/i });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const privacyRegion = page.getByRole('region', {
      name: 'How your words and voice are handled',
    });
    await expect(privacyRegion).toBeVisible();
    await expect(privacyRegion.getByText(/never stored as audio files/i)).toBeVisible();
    await expect(privacyRegion.getByText(/never shared, sold, or used for ads/i)).toBeVisible();

    await privacyRegion.getByRole('button', { name: 'Close privacy note' }).click();
    await expect(privacyRegion).toHaveCount(0);
  });

  test('Backend enforces audio duration, MIME allowlist, payload size, and IP rate limits', async ({
    request,
  }) => {
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
    const headers = { 'X-Forwarded-For': testIp };

    // 1. Duration > 185s rejected on backend
    const overDurationRes = await request.post('/api/ai/transcribe', {
      headers,
      data: {
        audioBase64: Buffer.alloc(600).toString('base64'),
        mimeType: 'audio/mp4',
        durationSeconds: 240,
      },
    });
    expect(overDurationRes.status()).toBe(400);

    // 2. Unsupported MIME type rejected cleanly
    const badMimeRes = await request.post('/api/ai/transcribe', {
      headers,
      data: {
        audioBase64: Buffer.alloc(600).toString('base64'),
        mimeType: 'audio/flac',
        durationSeconds: 12,
      },
    });
    expect(badMimeRes.status()).toBe(415);

    // 3. Oversized audio (> 4.5 MB decoded) rejected with 413
    const hugeBase64 = Buffer.alloc(4.7 * 1024 * 1024).toString('base64');
    const hugeRes = await request.post('/api/ai/transcribe', {
      headers,
      data: {
        audioBase64: hugeBase64,
        mimeType: 'audio/webm',
        durationSeconds: 90,
      },
    });
    expect(hugeRes.status()).toBe(413);

    // 4. IP rate limit triggers 429 + Retry-After after 10 requests in window (without calling Gemini)
    let hit429 = false;
    for (let i = 0; i < 10; i++) {
      const res = await request.post('/api/ai/transcribe', {
        headers,
        data: {
          audioBase64: Buffer.alloc(600).toString('base64'),
          mimeType: 'audio/mp4',
          durationSeconds: 240,
        },
      });
      if (res.status() === 429) {
        expect(res.headers()['retry-after']).toBeTruthy();
        hit429 = true;
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  test('Keyboard-only spatial card movement (Arrow / Shift+Arrow) and keyboard Connect Mode work cleanly', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Mind Map', exact: true }).click();
    await page.getByRole('button', { name: /Show All \(/i }).click();

    const firstCard = page.locator('[data-canvas-interactive="true"][tabindex="0"]').first();
    await expect(firstCard).toBeVisible();

    const firstLabel = (await firstCard.getAttribute('aria-label')) || '';
    const firstTitle = firstLabel.replace(/^[^:]+:\s*/, '');
    const initialPos = await firstCard.evaluate((el) => ({
      x: Number.parseInt((el as HTMLElement).style.left || '0', 10),
      y: Number.parseInt((el as HTMLElement).style.top || '0', 10),
    }));

    const readNodeAndEdgeState = () =>
      page.evaluate((title) => {
        const raw = window.localStorage.getItem('stillpoint_guest_sandbox_v1');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          nodes: Array<{ id: string; text: string; x: number; y: number }>;
          edges: Array<{ id: string; fromId: string; toId: string }>;
        };
        const target = parsed.nodes.find((n) => n.text === title);
        const linkedToTarget = new Set<string>();
        if (target) {
          linkedToTarget.add(target.id);
          for (const e of parsed.edges) {
            if (e.fromId === target.id) linkedToTarget.add(e.toId);
            if (e.toId === target.id) linkedToTarget.add(e.fromId);
          }
        }
        const unlinkedNode = parsed.nodes.find((n) => !linkedToTarget.has(n.id));
        return {
          x: target?.x ?? 0,
          y: target?.y ?? 0,
          edgeCount: parsed.edges.length,
          unlinkedTitle: unlinkedNode?.text ?? '',
        };
      }, firstTitle);

    // Focus first card and move spatially with ArrowRight (+20) and Shift+ArrowDown (+50)
    await firstCard.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');

    await expect
      .poll(async () => {
        const afterMove = await readNodeAndEdgeState();
        return afterMove ? `${afterMove.x},${afterMove.y}` : '';
      })
      .toBe(`${initialPos.x + 20},${initialPos.y + 50}`);

    const afterState = await readNodeAndEdgeState();
    expect(afterState).not.toBeNull();
    expect(afterState!.unlinkedTitle).toBeTruthy();

    // Connect two unlinked cards cleanly via keyboard: 'c' on first card -> focus second card -> Enter
    const secondCard = page
      .locator('[data-canvas-interactive="true"][tabindex="0"]', {
        hasText: afterState!.unlinkedTitle,
      })
      .first();
    await expect(secondCard).toBeVisible();
    await page.keyboard.press('c');
    await secondCard.focus();
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => (await readNodeAndEdgeState())?.edgeCount ?? 0)
      .toBe(afterState!.edgeCount + 1);
  });

  test('Mobile viewport exercises Safari audio/mp4 recording (no timeslice) and webkitAudioContext tap unlock', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.addInitScript(() => {
      const safariAudit = {
        silentUnlockPlayed: false,
        resumedCount: 0,
        recorderStartArgs: [] as unknown[],
      };
      (window as unknown as { __SAFARI_AUDIT__: typeof safariAudit }).__SAFARI_AUDIT__ = safariAudit;

      // Emulate Safari webkitAudioContext starting suspended until resumed + silent buffer played
      class MockAudioNode {
        connect() {
          return this;
        }
        disconnect() {}
      }
      class MockBufferSource extends MockAudioNode {
        buffer: { length?: number } | null = null;
        loop = false;
        start() {
          if (this.buffer && this.buffer.length === 1) {
            safariAudit.silentUnlockPlayed = true;
          }
        }
        stop() {}
      }
      class MockGain extends MockAudioNode {
        gain = {
          value: 0,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
          cancelScheduledValues() {},
          setTargetAtTime() {},
        };
      }
      class MockFilter extends MockAudioNode {
        type = 'lowpass';
        frequency = { value: 400 };
        Q = { value: 1 };
      }
      class MockWebkitAudioContext {
        state = 'suspended';
        sampleRate = 44100;
        currentTime = 0;
        destination = new MockAudioNode();
        async resume() {
          safariAudit.resumedCount += 1;
          this.state = 'running';
        }
        createGain() {
          return new MockGain();
        }
        createBiquadFilter() {
          return new MockFilter();
        }
        createBuffer(_ch: number, len: number) {
          return { length: len, getChannelData: () => new Float32Array(len) };
        }
        createBufferSource() {
          return new MockBufferSource();
        }
      }

      Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
      Object.defineProperty(window, 'webkitAudioContext', {
        configurable: true,
        value: MockWebkitAudioContext,
      });

      // Emulate Safari MediaRecorder supporting only audio/mp4 and returning video/mp4 container MIME
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
        },
      });

      class SafariMediaRecorder {
        public state: 'inactive' | 'recording' = 'inactive';
        public mimeType = 'video/mp4';
        public ondataavailable: ((e: { data: Blob }) => void) | null = null;
        public onstop: (() => void) | null = null;
        public onerror: (() => void) | null = null;

        static isTypeSupported(mime: string) {
          return mime === 'audio/mp4';
        }

        start(...args: unknown[]) {
          safariAudit.recorderStartArgs = args;
          this.state = 'recording';
        }

        stop() {
          this.state = 'inactive';
          const bytes = new Uint8Array(640).fill(7);
          this.ondataavailable?.({ data: new Blob([bytes], { type: 'video/mp4' }) });
          this.onstop?.();
        }
      }

      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: SafariMediaRecorder,
      });
    });

    let uploadedMime = '';
    await page.route('**/api/ai/transcribe', async (route) => {
      const payload = route.request().postDataJSON() as { mimeType?: string };
      uploadedMime = payload.mimeType || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transcript: 'Mobile voice note works cleanly.' }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Mind Map', exact: true })).toBeVisible();

    // Unlock webkitAudioContext via Sound tap on mobile
    await page.getByRole('button', { name: 'Faint Rain' }).click();
    const audioAudit = await page.evaluate(
      () =>
        (
          window as unknown as {
            __SAFARI_AUDIT__: { silentUnlockPlayed: boolean; resumedCount: number };
          }
        ).__SAFARI_AUDIT__
    );
    expect(audioAudit.resumedCount).toBeGreaterThanOrEqual(1);
    expect(audioAudit.silentUnlockPlayed).toBe(true);

    // Switch to mobile Journal tab and record with Safari MP4 path
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('button', { name: 'Stop recording' }).click();

    await expect(page.getByPlaceholder(/Empty your head here without editing/i)).toHaveValue(
      'Mobile voice note works cleanly.'
    );
    expect(uploadedMime).toBe('audio/mp4');

    const startArgs = await page.evaluate(
      () =>
        (window as unknown as { __SAFARI_AUDIT__: { recorderStartArgs: unknown[] } }).__SAFARI_AUDIT__
          .recorderStartArgs
    );
    expect(startArgs).toHaveLength(0);

    // On a short mobile screen, "How to use Mind Map" scrolls cleanly instead of getting clipped
    await page.setViewportSize({ width: 390, height: 540 });
    await page.getByRole('button', { name: 'Mind Map', exact: true }).click();
    await page.getByRole('button', { name: 'How to use Mind Map' }).click();
    const mobileGuide = page.getByRole('region', { name: 'How to use Mind Map' });
    await expect(mobileGuide).toBeVisible();
    const guideOverflowY = await mobileGuide.evaluate((el) => window.getComputedStyle(el).overflowY);
    expect(guideOverflowY).toBe('auto');
    const lastGuideCard = mobileGuide.getByText('Priority Hearth').first();
    await lastGuideCard.scrollIntoViewIfNeeded();
    await expect(lastGuideCard).toBeInViewport();
  });

  test('Priority Hearth Today reordering, Canvas empty-filter clear, Companion modes, and Pattern Spotlight jump', async ({
    page,
  }) => {
    await page.route('**/api/ai/encourage', async (route) => {
      const payload = route.request().postDataJSON() as { trigger?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title:
            payload.trigger === 'self-care'
              ? 'Warm tea and quiet shoulders'
              : payload.trigger === 'letting-go'
                ? 'Set down what is not yours today'
                : 'Right here in this room',
          message: 'Let everything else rest outside this hour while you tend just one small thing.',
          tinyStep: 'Settle shoulders and choose one clear next line.',
        }),
      });
    });

    await page.route('**/api/ai/find-patterns', async (route) => {
      const payload = route.request().postDataJSON() as { nodes?: Array<{ id: string }> };
      const firstId = payload.nodes?.[0]?.id || '';
      const secondId = payload.nodes?.[1]?.id || firstId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          patterns: [
            {
              title: 'Quiet anchor thread',
              insight: 'Steady mornings help every other thread fall into place.',
              tone: 'anchor',
              relatedNodeIds: firstId ? [firstId] : [],
            },
            {
              title: 'Steady evening pace',
              insight: 'Closing loops gently before dinner leaves tomorrow lighter.',
              tone: 'momentum',
              relatedNodeIds: secondId ? [secondId] : [],
            },
          ],
          companionNote: {
            title: 'Patterns clear the fog',
            message: 'Notice what keeps asking for a quiet hour first.',
            tinyStep: 'Keep one anchor protected tomorrow morning.',
          },
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nourishment', exact: true })).toBeVisible();

    const navTabTexts = await page.locator('header nav button').allInnerTexts();
    expect(navTabTexts).toEqual(['Nourishment', 'Journal', 'Mind Map', 'Sanctuaries']);

    await page.getByRole('button', { name: 'Mind Map', exact: true }).click();

    // Expand and collapse "How to use Mind Map" help guide icon
    const mapGuideBtn = page.getByRole('button', { name: 'How to use Mind Map' });
    await expect(mapGuideBtn).toHaveAttribute('aria-expanded', 'false');
    await mapGuideBtn.click();
    await expect(mapGuideBtn).toHaveAttribute('aria-expanded', 'true');
    const mapGuideRegion = page.getByRole('region', { name: 'How to use Mind Map' });
    await expect(mapGuideRegion.getByText('How to use Mind Map')).toBeVisible();
    await mapGuideRegion.getByRole('button', { name: 'Close Mind Map guide' }).click();
    await expect(mapGuideRegion).toHaveCount(0);

    // Add a second card pinned to Today so Priority Hearth has #01 and #02
    await page.getByRole('button', { name: 'Add Card' }).click();
    const addPopover = page.locator('form', { hasText: 'Place a card on the map' });
    await addPopover.getByPlaceholder('Card title or concrete step...').fill('Second anchor priority');
    await addPopover.getByRole('button', { name: 'Today', exact: true }).click();
    await addPopover.getByRole('button', { name: 'Add Card', exact: true }).click();

    // Reorder "Second anchor priority" up to #01 in Today
    const moveUpBtn = page.getByRole('button', { name: 'Move Second anchor priority up in Today' });
    await expect(moveUpBtn).toBeVisible();
    await moveUpBtn.click();

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('stillpoint_guest_sandbox_v1');
          if (!raw) return '';
          const parsed = JSON.parse(raw) as {
            nodes: Array<{ text: string; priorityTier: string; priorityOrder: number }>;
          };
          const nowSorted = parsed.nodes
            .filter((n) => n.priorityTier === 'now')
            .sort((a, b) => a.priorityOrder - b.priorityOrder);
          return nowSorted[0]?.text || '';
        })
      )
      .toBe('Second anchor priority');

    // Non-matching canvas filter shows clear overlay and resets cleanly
    const filterInput = page.getByRole('textbox', { name: 'Filter thoughts on map' });
    await filterInput.fill('zzzznonexistentthought');
    await expect(page.getByText('No thoughts match your current filter.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(page.getByText('No thoughts match your current filter.')).toHaveCount(0);

    // Nourishment: updated description, equal Wise Companion triggers + collapse/expand, compressed Find Pattern shifting + Daily Stoicism
    await page.getByRole('button', { name: 'Nourishment', exact: true }).click();
    await expect(
      page.getByText(
        /Tend your garden and breath, pause with the Wise Companion, uncover patterns, reflect on today’s Stoic tenet, and practice sensory grounding\./i
      )
    ).toBeVisible();

    const companionSection = page.getByRole('region', { name: 'Wise Companion', exact: true });
    const groundBtn = companionSection.getByRole('button', { name: 'Ground Me' });
    const selfCareBtn = companionSection.getByRole('button', { name: 'Self-Care' });
    const lettingGoBtn = companionSection.getByRole('button', { name: 'Letting Go' });
    await expect(groundBtn).toBeVisible();
    await expect(groundBtn).toHaveAttribute('class', await selfCareBtn.getAttribute('class') || '');
    await expect(lettingGoBtn).toHaveAttribute('class', await selfCareBtn.getAttribute('class') || '');

    await selfCareBtn.click();
    await expect(page.getByRole('heading', { name: 'Warm tea and quiet shoulders' })).toBeVisible();
    await lettingGoBtn.click();
    await expect(page.getByRole('heading', { name: 'Set down what is not yours today' })).toBeVisible();

    const companionToggle = companionSection.getByRole('button', { name: /Wise Companion/i });
    await expect(companionToggle).toHaveAttribute('aria-expanded', 'true');
    await companionToggle.click();
    await expect(companionToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(groundBtn).toHaveCount(0);
    await companionToggle.click();
    await expect(companionToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(groundBtn).toBeVisible();

    const findPatternBtn = page.getByRole('button', { name: 'Find Pattern', exact: true });
    await findPatternBtn.click();
    await expect(page.getByText('Quiet anchor thread')).toBeVisible();
    await expect(page.getByText(/1 of 2/i)).toBeVisible();
    await expect(page.getByText('Steady evening pace')).toHaveCount(0);

    // Pressing Find Pattern again shifts to the next pattern without stacking cards
    await findPatternBtn.click();
    await expect(page.getByText('Steady evening pace')).toBeVisible();
    await expect(page.getByText(/2 of 2/i)).toBeVisible();
    await expect(page.getByText('Quiet anchor thread')).toHaveCount(0);

    // Daily Stoicism tenet expands and collapses cleanly
    const stoicSection = page.getByRole('region', { name: 'Daily Stoicism', exact: true });
    await expect(stoicSection).toBeVisible();
    const readMoreBtn = stoicSection.getByRole('button', { name: 'Read more' });
    await expect(readMoreBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(stoicSection.getByText('Quiet practice for today')).toHaveCount(0);
    await readMoreBtn.click();
    await expect(stoicSection.getByText('Quiet practice for today')).toBeVisible();
    const showLessBtn = stoicSection.getByRole('button', { name: 'Show less' });
    await expect(showLessBtn).toHaveAttribute('aria-expanded', 'true');
    await showLessBtn.click();
    await expect(stoicSection.getByText('Quiet practice for today')).toHaveCount(0);

    const spotlightBtn = page.getByRole('button', { name: /Spotlight on Map/i });
    await expect(spotlightBtn).toBeVisible();
    await spotlightBtn.click();

    await expect(page.getByText(/Spotlighting pattern:/i)).toBeVisible();
    await expect(page.getByText('Steady evening pace')).toBeVisible();
  });

  test('Journal recording Cancel skips transcription, Soundscape volume persists, and malformed API JSON returns clean JSON 400', async ({
    page,
    request,
  }) => {
    await installVoiceRecordingMock(page);

    let transcribeCalled = false;
    await page.route('**/api/ai/transcribe', async (route) => {
      transcribeCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transcript: 'Should not happen' }),
      });
    });

    await page.goto('/');

    // Adjust Soundscape volume slider and confirm persistence across reload
    const slider = page.getByRole('slider', { name: 'Soundscape volume' });
    await slider.fill('28');
    await slider.dispatchEvent('change');
    await expect(page.getByText('28%')).toBeVisible();

    await page.reload();
    await expect(page.getByText('28%')).toBeVisible();

    // Breathwork gentle phase chime toggle works
    await page.getByRole('button', { name: 'Nourishment', exact: true }).click();
    const chimeBtn = page.getByRole('button', { name: 'Enable gentle phase chime' });
    await expect(chimeBtn).toHaveAttribute('aria-pressed', 'false');
    await chimeBtn.click();
    await expect(page.getByRole('button', { name: 'Disable gentle phase chime' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Journal voice recording Cancel skips transcription API call
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel recording' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel recording' }).click();

    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
    expect(transcribeCalled).toBe(false);

    // Malformed JSON payload returns clean JSON 400 rather than HTML stack trace
    const malformedRes = await request.post('/api/ai/encourage', {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 10}`,
      },
      data: '{broken-json',
    });
    expect(malformedRes.status()).toBe(400);
    const malformedJson = (await malformedRes.json()) as { error?: string };
    expect(malformedJson.error).toContain('malformed JSON');
  });
});



