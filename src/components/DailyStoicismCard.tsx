import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

interface StoicTenet {
  title: string;
  philosopher: string;
  quote: string;
  summary: string;
  reflection: string;
  practice: string;
}

const STOIC_TENETS: StoicTenet[] = [
  {
    title: 'The Dichotomy of Control',
    philosopher: 'Epictetus · Enchiridion I',
    quote: 'Some things are up to us, and some things are not up to us.',
    summary: 'Peace begins the moment we stop fighting outcomes we do not govern and pour care into our own choices.',
    reflection:
      'Epictetus opens his handbook with a clear dividing line: your intentions, responses, values, and attention belong to you; other people’s moods, past mistakes, and external delays do not. Most mental exhaustion comes from trying to steer the second category with the energy meant for the first.',
    practice:
      'Pick one worry on your mind today and sort it gently: what part belongs to your own next action, and what part belongs to chance?',
  },
  {
    title: 'Suffering More in Imagination',
    philosopher: 'Seneca · Letters XIII',
    quote: 'We suffer more often in imagination than in reality.',
    summary: 'An anxious mind rehearses ten storms for every cloud that actually arrives.',
    reflection:
      'Seneca noticed how quickly foresight turns into self-inflicted pain when we treat distant possibilities as present emergencies. By returning to what is actually happening in this exact room, most imagined weight dissolves into something ordinary and manageable.',
    practice:
      'Whenever a future worry spikes, ask plainly: is this happening right now, or am I borrowing tomorrow’s weather?',
  },
  {
    title: 'Do Less, Better',
    philosopher: 'Marcus Aurelius · Meditations IV.24',
    quote: 'If you seek tranquility, do less—only what is essential.',
    summary: 'Calm does not require rushing through everything; it comes from leaving out what does not matter.',
    reflection:
      'Writing between state crises and sleepless nights, Marcus reminded himself that busyness masquerades as duty. Doing fewer things with full, unhurried presence brings twice the clarity and spares the mind from pointless scatter.',
    practice:
      'Choose one non-essential obligation today and quietly set it down without guilt.',
  },
  {
    title: 'Amor Fati — Meet What Arrives',
    philosopher: 'Marcus Aurelius · Meditations VIII.35',
    quote: 'Receive what happens without arrogance, and let it go without attachment.',
    summary: 'Accepting reality as it stands frees the energy we otherwise spend wishing it were different.',
    reflection:
      'Stoic acceptance is not passive resignation; it is clear-eyed honesty. Only once you stop arguing with the shape of the day in front of you can you move through it gracefully and respond with wisdom.',
    practice:
      'Notice one minor delay or disruption today and greet it silently with: “This is the material I have to work with.”',
  },
  {
    title: 'Guard the Quiet Citadel',
    philosopher: 'Marcus Aurelius · Meditations VII.28',
    quote: 'Retreat into yourself; the rational mind is by nature self-sufficient when it acts justly.',
    summary: 'Steadiness is an inner room you can return to even in the middle of noisy demands.',
    reflection:
      'You do not need an empty calendar or a week away to find stillness. The Stoics practiced carrying a small quiet center wherever they walked—pausing for a single breath between stimulus and response.',
    practice:
      'Before replying to the next demanding message, pause for three slow breaths so you respond by choice rather than reflex.',
  },
  {
    title: 'Focus on the Effort, Not the Applause',
    philosopher: 'Epictetus · Discourses II.16',
    quote: 'Make the best use of what is in your power, and take the rest as it happens.',
    summary: 'Judge a day by the honesty and care of your effort, not by applause or perfect results.',
    reflection:
      'An archer can aim steadily, account for the wind, and release cleanly—yet once the arrow leaves the bow, a sudden gust can still nudge its path. Peace comes from locating self-respect in how well you aimed, not in guaranteeing the wind.',
    practice:
      'Define “enough” for today by an honest step you control, rather than an outcome someone else decides.',
  },
  {
    title: 'Live in the Narrow Slice of Now',
    philosopher: 'Marcus Aurelius · Meditations III.10',
    quote: 'Each of us lives only in the present, this brief instant; the rest has either been lived or is uncertain.',
    summary: 'The weight of an entire year feels unbearable only when you try to lift it inside a single afternoon.',
    reflection:
      'Regret pulls backward and dread pulls forward, leaving the actual hour abandoned. Marcus broke overwhelming burdens down into single present actions, knowing that any human being can bear one honest moment at a time.',
    practice:
      'Ask yourself softly: “What is unbearable about this exact minute?” Let the rest wait its turn.',
  },
  {
    title: 'Pause Before Assigning Meaning',
    philosopher: 'Epictetus · Discourses III.8',
    quote: 'You are just an impression, and not at all what you claim to represent.',
    summary: 'A neutral event and our fearful story about it are two different things.',
    reflection:
      'Between something happening and our feeling upset sits an instant judgment—“this is a disaster” or “I am failing.” Epictetus taught students to hold first impressions at arm’s length until facts and kindness had time to speak.',
    practice:
      'Separate one sticky worry into bare facts first, stripping away adjectives like “ruined,” “always,” or “never.”',
  },
  {
    title: 'Treat Delays as Part of the Path',
    philosopher: 'Marcus Aurelius · Meditations V.20',
    quote: 'The impediment to action advances action. What stands in the way becomes the way.',
    summary: 'Friction is rarely a sign you are on the wrong road; it is simply the texture of real work.',
    reflection:
      'Rather than seeing interruptions, fatigue, or obstacles as enemies of your plan, Stoicism invites you to fold them into the craft itself—practicing patience, adaptability, and humility right where resistance appears.',
    practice:
      'Look at one slow-moving card on your map as a place to practice steadiness rather than irritation.',
  },
  {
    title: 'Measure Time Like Treasure',
    philosopher: 'Seneca · On the Shortness of Life',
    quote: 'It is not that we have a short time to live, but that we waste much of it.',
    summary: 'Protect your attention as carefully as you would guard your savings or your sleep.',
    reflection:
      'Seneca observed that people guard their property fiercely yet hand away hours of attention to trivial distractions and grudges without noticing. Reclaiming even twenty unhurried minutes changes the texture of a whole day.',
    practice:
      'Give one small window today exclusively to something genuinely meaningful to you.',
  },
  {
    title: 'Gentle Expectations Soften Anger',
    philosopher: 'Seneca · On Anger III.26',
    quote: 'Why be angry at the world? It pays no heed to your anger.',
    summary: 'People and days act according to their nature and fatigue, not to spite you.',
    reflection:
      'Frustration flares when we insist reality obey an unspoken script in our heads. Seeing others—and ourselves—as imperfect human beings navigating complex days turns sharp resentment into calm boundaries.',
    practice:
      'Where irritation crept in today, replace “this shouldn’t be happening” with “how do I wish to meet this?”',
  },
  {
    title: 'Practice Voluntary Simplicity',
    philosopher: 'Musonius Rufus · Lectures XIX',
    quote: 'We should accustom ourselves to need little, so fear loses its hold over us.',
    summary: 'Simplicity shrinks anxiety by proving how little is truly required for a good day.',
    reflection:
      'When your peace depends on flawless conditions, constant stimulation, or endless validation, life feels fragile. Choosing plain comfort, quiet meals, and modest goals makes your contentment remarkably sturdy.',
    practice:
      'Enjoy one simple, unhurried ritual today—tea, a walk, or quiet reading—without adding anything to it.',
  },
  {
    title: 'Speak Gently to Yourself',
    philosopher: 'Seneca · Letters VI',
    quote: 'What progress have I made? I have begun to be a friend to myself.',
    summary: 'Inner harshness never creates lasting wisdom; honest self-friendship does.',
    reflection:
      'Stoicism is often mistaken for cold self-criticism, yet Seneca celebrated becoming his own steady friend. Examining mistakes cleanly without cruelty leaves you lighter and wiser tomorrow.',
    practice:
      'Notice your inner tone if something went unfinished today, and offer the same patient counsel you would give a friend.',
  },
  {
    title: 'See the Whole View from Above',
    philosopher: 'Marcus Aurelius · Meditations IX.30',
    quote: 'Look down from above on the countless flocks, ceremonies, journeys, and passing storms.',
    summary: 'Zooming out shrinks today’s urgency back to its honest, human proportions.',
    reflection:
      'A small slight or missed inbox thread feels enormous when pressed right against the lens. Stepping back to imagine your life across seasons restores warmth, humor, and perspective on what truly deserves your heart.',
    practice:
      'Ask quietly: “Will this worry matter a season from now, or what genuinely will?”',
  },
];

function getDailyStoicTenet(date = new Date()): { tenet: StoicTenet; dayLabel: string } {
  const utcDayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  );
  const index = ((utcDayNumber % STOIC_TENETS.length) + STOIC_TENETS.length) % STOIC_TENETS.length;
  const dayLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { tenet: STOIC_TENETS[index], dayLabel };
}

export const DailyStoicismCard: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const { tenet, dayLabel } = useMemo(() => getDailyStoicTenet(), []);

  return (
    <section
      aria-label="Daily Stoicism"
      className="bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg p-5 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#DDD1BD]">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#94622A]" />
          <h2 className="font-display text-base font-medium text-[#2B2118]">
            Daily Stoicism
          </h2>
        </div>
        <span className="font-mono-tabular text-[11px] text-[#8C7A68]">
          Today · {dayLabel}
        </span>
      </div>

      <div className="rounded-md bg-[#F4ECE0]/75 border border-[#DDD1BD] p-4 space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#2B2118] leading-snug">
            {tenet.title}
          </h3>
          <span className="text-[11px] font-medium text-[#8C7A68]">
            {tenet.philosopher}
          </span>
        </div>

        <blockquote className="font-display italic text-sm text-[#4E3F31] leading-relaxed border-l-2 border-[#C48A47]/70 pl-3">
          “{tenet.quote}”
        </blockquote>

        <p className="text-xs leading-relaxed text-[#635345]">
          {tenet.summary}
        </p>

        {expanded && (
          <div className="pt-2.5 mt-1 border-t border-[#DDD1BD] space-y-2.5 text-xs">
            <p className="leading-relaxed text-[#2B2118]">
              {tenet.reflection}
            </p>
            <div className="rounded bg-[#FBF6EC] border border-[#DDD1BD] px-3 py-2">
              <p className="text-[11px] font-medium text-[#5F735D]">Quiet practice for today</p>
              <p className="text-xs text-[#635345] mt-0.5 leading-relaxed">
                {tenet.practice}
              </p>
            </div>
          </div>
        )}

        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5F735D] hover:text-[#2B2118] transition-colors"
          >
            <span>{expanded ? 'Show less' : 'Read more'}</span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
};
