import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from '@babylonjs/core';
import { CHAPTERS, GRID_CHOICE_CHAPTER } from '../src/game/story/script.ts';
import { CAST } from '../src/game/story/cast.ts';
import { Campaign } from '../src/game/story/Campaign.ts';
import { rogueById } from '../src/game/npc/Rogue.ts';

const citySource = await readFile(new URL('../src/game/world/City.ts', import.meta.url), 'utf8');
const landmarks = new Set([...citySource.matchAll(/id: "([^"]+)"/g)].map(match => match[1]));
const input = { consume: () => true, movement: () => ({ x: 0, y: 0 }) };

function worldAndDialogue(decision = 'restore-public-grid') {
  const positions = new Map([...landmarks].map((id, i) => [id, new Vector3(i * 100, 0, i * 70)]));
  const transcript = [];
  let sites = 0;
  const profile = { routeReplays: {}, roguesBeaten: [] };
  const world = {
    city: {
      sky: { setAtmosphere() {} },
      landmark: id => {
        assert.ok(positions.has(id), `Missing real city landmark: ${id}`);
        return { position: positions.get(id) };
      },
      nearestRoad: position => position.clone(),
      roadPointNear: centre => centre.add(new Vector3(60 + (++sites % 5) * 35, 0, 60)),
    },
    player: {
      position: Vector3.Zero(), speed: 280, speedKph: 1008, health: 100, charge: 100,
      root: { rotation: { y: 0 } },
      teleport(position) { this.position.copyFrom(position); },
    },
    save: { data: profile, bestFor: () => null, recordRoute: () => true, update: fn => fn(profile) },
    effects: { pulse() {}, burst() {} },
    rng: () => 0.5, toast() {}, clearRogues() {}, releaseBystanders() {},
    takeBystander: () => null, spawnRogue: () => ({ phantom: false }), activeRogues: () => [],
  };
  const dialogue = {
    active: false, chosen: null, options: null,
    show(lines) { this.active = true; transcript.push(...lines); },
    ask(prompt, options) { this.active = true; this.options = options; transcript.push({ who: 'narration', text: prompt }); },
    advance() {
      if (this.options) {
        const picked = this.options.find(option => option.id === decision) ?? this.options[0];
        this.chosen = picked.id;
        transcript.push(...picked.outcome);
        this.options = null;
      }
      this.active = false;
    },
    hide() { this.active = false; this.chosen = null; this.options = null; },
    cycle() {},
  };
  return { world, dialogue, transcript };
}

function validateAnchor(anchor, context) {
  if (anchor.at === 'landmark') assert.ok(landmarks.has(anchor.id), `${context}: missing ${anchor.id}`);
  if (anchor.at === 'point') assert.ok(Number.isFinite(anchor.x) && Number.isFinite(anchor.z), context);
}

function validateBeats(beats, context) {
  for (const beat of beats) {
    if (beat.anchor) validateAnchor(beat.anchor, context);
    if (beat.lines) for (const line of beat.lines) {
      assert.ok(line.who === 'narration' || CAST[line.who], `${context}: missing speaker ${line.who}`);
      assert.ok(line.text.trim().length > 0);
    }
    if (beat.rogue) assert.ok(rogueById(beat.rogue), context);
    if (beat.kind === 'route') {
      assert.ok(beat.stops?.length >= 2, `${context}: authored routes need meaningful destinations`);
      for (const stop of beat.stops) validateAnchor(stop, context);
    }
    if (beat.kind === 'choice') {
      assert.equal(new Set(beat.options.map(option => option.id)).size, 2);
      for (const option of beat.options) validateBeats([{ kind: 'talk', lines: option.outcome }], context);
    }
    if (beat.kind === 'branch') {
      if (beat.chapter) assert.ok(CHAPTERS.some(chapter => chapter.id === beat.chapter));
      validateBeats(beat.fallback, context);
      for (const branch of Object.values(beat.outcomes)) validateBeats(branch, context);
    }
  }
}

test('campaign keeps old save identities and every authored reference resolves', () => {
  assert.deepEqual(CHAPTERS.slice(0, 12).map(chapter => chapter.id), [
    'ch01-longest-second', 'ch02-eleven-months', 'ch03-runs-hot', 'ch04-the-streak',
    'ch05-dead-seconds', 'ch06-pressure-systems', 'ch07-cold-equation', 'ch08-what-wren-knows',
    'ch09-negative-resonance', 'ch10-twenty-two-years', 'ch11-man-in-the-chair', 'ch12-fastest-dude-alive',
  ]);
  assert.deepEqual(CHAPTERS.map(chapter => chapter.number), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(new Set(CHAPTERS.map(chapter => chapter.id)).size, 15);
  for (const chapter of CHAPTERS) {
    validateAnchor(chapter.spawn, chapter.title);
    validateBeats(chapter.beats, chapter.title);
  }
});

for (const decision of ['restore-public-grid', 'disconnect-grid', null]) {
  test(`all fifteen chapters terminate for ${decision ?? 'a legacy save without a decision'}`, () => {
    const scriptBefore = JSON.stringify(CHAPTERS);
    const choices = decision ? { [GRID_CHOICE_CHAPTER]: decision } : {};
    const objectiveTitles = [];
    const seenLines = [];
    for (const chapter of CHAPTERS) {
      const { world, dialogue, transcript } = worldAndDialogue(decision ?? undefined);
      const campaign = new Campaign(chapter, world, dialogue, choices);
      campaign.start();
      let result = 'running';
      let ticks = 0;
      while (result === 'running' && ticks++ < 500) {
        const marker = campaign.markers()[0];
        if (marker && !dialogue.active) world.player.position.copyFrom(marker.position);
        if (campaign.status().title === 'Get above the dead zone' && !dialogue.active) world.player.position.y = 50;
        objectiveTitles.push(campaign.status().title);
        result = campaign.update(1, input);
      }
      assert.equal(result, 'complete', `${chapter.title} stalled at ${campaign.status().title}`);
      if (chapter.id === GRID_CHOICE_CHAPTER) assert.equal(campaign.choice, decision ?? 'restore-public-grid');
      seenLines.push(...transcript.map(line => line.text));
      campaign.stop();
    }
    assert.equal(JSON.stringify(CHAPTERS), scriptBefore, 'branch expansion mutated the reusable chapter data');
    const tasks = objectiveTitles.join('\n');
    if (decision === 'restore-public-grid') {
      assert.match(tasks, /Survey Northline's relays/);
      assert.doesNotMatch(tasks, /Meet the stranded supply crews/);
      assert.ok(seenLines.some(text => text.includes('independent audit')));
    } else if (decision === 'disconnect-grid') {
      assert.match(tasks, /Meet the stranded supply crews/);
      assert.doesNotMatch(tasks, /Survey Northline's relays/);
      assert.ok(seenLines.some(text => text.includes('shared fuel reserves')));
    } else {
      assert.match(tasks, /Verify Northline's equipment/);
      assert.ok(seenLines.some(text => text.includes('no emergency plan becomes permanent')));
    }
  });
}

test('dying during a story rescue fails the chapter instead of leaving the clock running', () => {
  const { world, dialogue } = worldAndDialogue();
  const campaign = new Campaign(CHAPTERS[0], world, dialogue, {});
  campaign.start();
  let ticks = 0;
  while (ticks++ < 50 && !campaign.status().title.includes('Clear the bridge')) {
    const marker = campaign.markers()[0];
    if (marker && !dialogue.active) world.player.position.copyFrom(marker.position);
    if (world.player.speedKph < 200) world.player.speedKph = 200;
    campaign.update(1, input);
  }
  assert.match(campaign.status().title, /Clear the bridge/);
  world.player.health = 0;
  assert.equal(campaign.update(1, input), 'failed');
  campaign.stop();
});

test('unknown or inherited choice names use the legacy fallback without crashing', () => {
  for (const decision of ['unrecognized-ending', 'constructor', '__proto__']) {
    const { world, dialogue } = worldAndDialogue();
    const campaign = new Campaign(CHAPTERS[12], world, dialogue, { [GRID_CHOICE_CHAPTER]: decision });
    campaign.start();
    campaign.update(1, input);
    campaign.update(1, input);
    assert.equal(campaign.status().title, "Verify Northline's equipment");
    campaign.stop();
  }
});

test('authored destinations stay ordered and the deadline is visible; finishing on it succeeds', () => {
  const { world, dialogue } = worldAndDialogue();
  const chapter = {
    ...CHAPTERS[0],
    beats: [{ kind: 'route', title: 'Deadline route', detail: 'Visit the ordered stops', anchor: { at: 'player' }, gates: 2, spread: 0,
      stops: [{ at: 'landmark', id: 'halcyon-labs' }, { at: 'landmark', id: 'ridgeline-transit' }], seconds: 2 }],
  };
  const campaign = new Campaign(chapter, world, dialogue);
  campaign.start();
  assert.equal(campaign.status().timer, 2);
  assert.match(campaign.status().detail, /2s left/);
  assert.ok(campaign.markers()[0].position.equals(world.city.landmark('halcyon-labs').position));
  world.player.position.copyFrom(campaign.markers()[0].position);
  assert.equal(campaign.update(1, input), 'running');
  assert.ok(campaign.markers()[0].position.equals(world.city.landmark('ridgeline-transit').position));
  world.player.position.copyFrom(campaign.markers()[0].position);
  assert.equal(campaign.update(1, input), 'complete');
});
