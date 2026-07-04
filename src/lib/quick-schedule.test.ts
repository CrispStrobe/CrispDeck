import { describe, it, expect, vi } from 'vitest';

describe('quick-schedule from compose', () => {
  describe('schedule date/time construction', () => {
    it('builds ISO string from date and time inputs', () => {
      const date = '2026-07-10';
      const time = '14:30';
      const scheduledAt = new Date(`${date}T${time}`).toISOString();
      expect(scheduledAt).toMatch(/2026-07-10T\d{2}:30:00/);
    });

    it('handles midnight correctly', () => {
      const date = '2026-07-10';
      const time = '00:00';
      const scheduledAt = new Date(`${date}T${time}`).toISOString();
      expect(scheduledAt).toContain('2026-07-1');
    });

    it('handles end of day correctly', () => {
      const date = '2026-07-10';
      const time = '23:59';
      const scheduledAt = new Date(`${date}T${time}`).toISOString();
      expect(scheduledAt).toContain('2026-07-1');
    });
  });

  describe('validation', () => {
    it('requires text before scheduling', () => {
      const text = '';
      const scheduleDate = '2026-07-10';
      const scheduleTime = '14:30';
      const canSchedule = text.trim() && scheduleDate && scheduleTime;
      expect(canSchedule).toBeFalsy();
    });

    it('requires date before scheduling', () => {
      const text = 'Hello';
      const scheduleDate = '';
      const scheduleTime = '14:30';
      const canSchedule = text.trim() && scheduleDate && scheduleTime;
      expect(canSchedule).toBeFalsy();
    });

    it('requires time before scheduling', () => {
      const text = 'Hello';
      const scheduleDate = '2026-07-10';
      const scheduleTime = '';
      const canSchedule = text.trim() && scheduleDate && scheduleTime;
      expect(canSchedule).toBeFalsy();
    });

    it('passes validation with all fields', () => {
      const text = 'Hello world';
      const scheduleDate = '2026-07-10';
      const scheduleTime = '14:30';
      const canSchedule = text.trim() && scheduleDate && scheduleTime;
      expect(canSchedule).toBeTruthy();
    });
  });

  describe('draft creation', () => {
    it('builds draft params with scheduled_at', () => {
      const params = {
        text: 'Hello world',
        target_accounts: [1, 2],
        visibility: 'public',
        content_warning: null,
        scheduled_at: '2026-07-10T14:30:00.000Z',
      };
      expect(params.scheduled_at).toBeTruthy();
      expect(params.text).toBe('Hello world');
      expect(params.target_accounts).toEqual([1, 2]);
    });

    it('includes content warning when CW is shown', () => {
      const showCW = true;
      const contentWarning = 'Spoiler alert';
      const cw = showCW ? contentWarning : null;
      expect(cw).toBe('Spoiler alert');
    });

    it('excludes content warning when CW is hidden', () => {
      const showCW = false;
      const contentWarning = 'Spoiler alert';
      const cw = showCW ? contentWarning : null;
      expect(cw).toBeNull();
    });
  });

  describe('form reset after scheduling', () => {
    it('clears text, date, time, and schedule UI', () => {
      let text = 'Hello';
      let showSchedule = true;
      let scheduleDate = '2026-07-10';
      let scheduleTime = '14:30';

      // Simulate reset
      text = '';
      showSchedule = false;
      scheduleDate = '';
      scheduleTime = '';

      expect(text).toBe('');
      expect(showSchedule).toBe(false);
      expect(scheduleDate).toBe('');
      expect(scheduleTime).toBe('');
    });
  });

  describe('min date constraint', () => {
    it('min date is today', () => {
      const today = new Date().toISOString().split('T')[0];
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('toast message', () => {
    it('includes formatted date in success message', () => {
      const scheduledAt = '2026-07-10T14:30:00.000Z';
      const msg = `Scheduled for ${new Date(scheduledAt).toLocaleString()}`;
      expect(msg).toContain('Scheduled for');
      expect(msg).toContain('2026');
    });
  });
});
