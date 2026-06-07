import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMilestoneConfig, setMilestoneConfig, checkMilestones, getRecentMilestones } from './milestones';

describe('milestones', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
    // Mock Notification + AudioContext
    vi.stubGlobal('Notification', { permission: 'denied' });
    vi.stubGlobal('AudioContext', class { createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }; } createGain() { return { connect() {}, gain: { value: 0, exponentialRampToValueAtTime() {} } }; } get currentTime() { return 0; } get destination() { return {}; } });
  });

  it('returns default config', () => {
    const config = getMilestoneConfig();
    expect(config.enabled).toBe(true);
    expect(config.thresholds).toEqual([10, 50, 100, 500, 1000]);
  });

  it('saves config', () => {
    setMilestoneConfig({ thresholds: [5, 25, 100] });
    expect(getMilestoneConfig().thresholds).toEqual([5, 25, 100]);
  });

  it('detects new milestones', () => {
    const milestones = checkMilestones({
      uri: 'at://post-1', text: 'Popular post',
      likeCount: 55, repostCount: 5, replyCount: 3,
    });
    // Should detect: likes >= 10, likes >= 50, total >= 10, total >= 50
    expect(milestones.length).toBeGreaterThan(0);
    expect(milestones.some(m => m.metric === 'likes' && m.threshold === 50)).toBe(true);
  });

  it('does not re-trigger reached milestones', () => {
    checkMilestones({ uri: 'at://post-1', text: 'Post', likeCount: 55 });
    const second = checkMilestones({ uri: 'at://post-1', text: 'Post', likeCount: 60 });
    // 10 and 50 already reached, no new milestone
    expect(second.filter(m => m.metric === 'likes' && m.threshold <= 50)).toHaveLength(0);
  });

  it('triggers new threshold when crossed', () => {
    checkMilestones({ uri: 'at://post-1', text: 'Post', likeCount: 55 });
    const milestones = checkMilestones({ uri: 'at://post-1', text: 'Post', likeCount: 105 });
    expect(milestones.some(m => m.metric === 'likes' && m.threshold === 100)).toBe(true);
  });

  it('returns empty when disabled', () => {
    setMilestoneConfig({ enabled: false });
    const milestones = checkMilestones({ uri: 'at://post-1', text: 'Post', likeCount: 1000 });
    expect(milestones).toHaveLength(0);
  });

  it('tracks recent milestones', () => {
    checkMilestones({ uri: 'at://post-1', text: 'Post', likeCount: 55 });
    const recent = getRecentMilestones();
    expect(recent.length).toBeGreaterThan(0);
  });
});
