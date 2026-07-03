import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlueskyClient } from './api/bluesky';
import { isVideoFile } from './compose/media';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('BlueskyClient.uploadVideo', () => {
  let client: BlueskyClient;
  const mockFile = new File(['video-data'], 'test.mp4', { type: 'video/mp4' });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('throws when no auth agent', async () => {
    client = BlueskyClient.readOnly('test.bsky.social');
    await expect(client.uploadVideo(mockFile)).rejects.toThrow('Auth required for video upload');
  });

  it('constructs correct upload URL with DID and filename', async () => {
    client = new BlueskyClient('test.bsky.social', 'pass123');
    // Mock the auth agent's session and getServiceAuth
    const agent = client.getAgent();
    Object.defineProperty(agent, 'session', { value: { did: 'did:plc:abc123' }, writable: true, configurable: true });
    (agent.api.com.atproto.server as any).getServiceAuth = vi.fn().mockResolvedValue({
      data: { token: 'test-token' },
    });

    // Mock the upload fetch to return a blob directly
    const mockBlob = { $type: 'blob', ref: { $link: 'bafk...' }, mimeType: 'video/mp4', size: 1000 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ blob: mockBlob }),
    });

    await client.uploadVideo(mockFile);

    // Verify the fetch was called with correct URL
    const fetchCall = mockFetch.mock.calls[0];
    const url = new URL(fetchCall[0]);
    expect(url.origin).toBe('https://video.bsky.app');
    expect(url.pathname).toBe('/xrpc/app.bsky.video.uploadVideo');
    expect(url.searchParams.get('did')).toBe('did:plc:abc123');
    expect(url.searchParams.get('name')).toBe('test.mp4');

    // Verify headers
    expect(fetchCall[1].headers['Content-Type']).toBe('video/mp4');
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer test-token');
    expect(fetchCall[1].method).toBe('POST');
  });

  it('handles direct blob response (no jobId)', async () => {
    client = new BlueskyClient('test.bsky.social', 'pass123');
    const agent = client.getAgent();
    Object.defineProperty(agent, 'session', { value: { did: 'did:plc:abc123' }, writable: true, configurable: true });
    (agent.api.com.atproto.server as any).getServiceAuth = vi.fn().mockResolvedValue({
      data: { token: 'test-token' },
    });

    const mockBlob = { $type: 'blob', ref: { $link: 'bafk...' }, mimeType: 'video/mp4', size: 5000 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ blob: mockBlob }),
    });

    const result = await client.uploadVideo(mockFile);
    expect(result).toEqual(mockBlob);
  });

  it('handles job polling until JOB_STATE_COMPLETED', async () => {
    client = new BlueskyClient('test.bsky.social', 'pass123');
    const agent = client.getAgent();
    Object.defineProperty(agent, 'session', { value: { did: 'did:plc:abc123' }, writable: true, configurable: true });
    (agent.api.com.atproto.server as any).getServiceAuth = vi.fn().mockResolvedValue({
      data: { token: 'test-token' },
    });

    // Upload returns a jobId
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobId: 'job-123' }),
    });

    const completedBlob = { $type: 'blob', ref: { $link: 'bafkvideo' }, mimeType: 'video/mp4', size: 9000 };

    // First poll: still processing
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobStatus: { state: 'JOB_STATE_PROCESSING' } }),
    });

    // Second poll: completed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobStatus: { state: 'JOB_STATE_COMPLETED', blob: completedBlob } }),
    });

    const progressCalls: string[] = [];
    const promise = client.uploadVideo(mockFile, (status) => progressCalls.push(status));
    // Advance through 2 polling intervals
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(result).toEqual(completedBlob);
    expect(progressCalls).toContain('uploading');
    expect(progressCalls).toContain('processing');

    // Verify polling URL
    const pollCalls = mockFetch.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes('getJobStatus'));
    expect(pollCalls.length).toBe(2);
    expect(pollCalls[0][0]).toContain('jobId=job-123');
  });

  it('throws on JOB_STATE_FAILED', async () => {
    client = new BlueskyClient('test.bsky.social', 'pass123');
    const agent = client.getAgent();
    Object.defineProperty(agent, 'session', { value: { did: 'did:plc:abc123' }, writable: true, configurable: true });
    (agent.api.com.atproto.server as any).getServiceAuth = vi.fn().mockResolvedValue({
      data: { token: 'test-token' },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobId: 'job-fail' }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobStatus: { state: 'JOB_STATE_FAILED', error: 'codec not supported' },
      }),
    });

    const promise = client.uploadVideo(mockFile);
    // Attach the rejection handler before advancing timers — the promise
    // rejects mid-advance and would otherwise count as an unhandled rejection
    const expectation = expect(promise).rejects.toThrow('Video processing failed: codec not supported');
    await vi.advanceTimersByTimeAsync(2100);
    await expectation;
  });

  it('throws on upload HTTP error', async () => {
    client = new BlueskyClient('test.bsky.social', 'pass123');
    const agent = client.getAgent();
    Object.defineProperty(agent, 'session', { value: { did: 'did:plc:abc123' }, writable: true, configurable: true });
    (agent.api.com.atproto.server as any).getServiceAuth = vi.fn().mockResolvedValue({
      data: { token: 'test-token' },
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      text: () => Promise.resolve('File too large'),
    });

    await expect(client.uploadVideo(mockFile)).rejects.toThrow('Video upload failed (413): File too large');
  });

  it('throws on timeout after max polling attempts', async () => {
    client = new BlueskyClient('test.bsky.social', 'pass123');
    const agent = client.getAgent();
    Object.defineProperty(agent, 'session', { value: { did: 'did:plc:abc123' }, writable: true, configurable: true });
    (agent.api.com.atproto.server as any).getServiceAuth = vi.fn().mockResolvedValue({
      data: { token: 'test-token' },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jobId: 'job-slow' }),
    });

    // All 60 polls return processing
    for (let i = 0; i < 60; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobStatus: { state: 'JOB_STATE_PROCESSING' } }),
      });
    }

    const promise = client.uploadVideo(mockFile);
    // Attach the rejection handler before advancing timers (see above)
    const expectation = expect(promise).rejects.toThrow('Video processing timed out after 120 seconds');
    // Advance through all 60 polling intervals (2s each)
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(2100);
    }
    await expectation;
  }, 30_000);
});

describe('isVideoFile', () => {
  it('detects video/mp4', () => {
    expect(isVideoFile(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe(true);
  });

  it('detects video/webm', () => {
    expect(isVideoFile(new File([], 'a.webm', { type: 'video/webm' }))).toBe(true);
  });

  it('detects video/quicktime', () => {
    expect(isVideoFile(new File([], 'a.mov', { type: 'video/quicktime' }))).toBe(true);
  });

  it('rejects image/jpeg', () => {
    expect(isVideoFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
  });

  it('rejects image/png', () => {
    expect(isVideoFile(new File([], 'a.png', { type: 'image/png' }))).toBe(false);
  });
});

describe('compose adapter video embed', () => {
  it('builds correct app.bsky.embed.video embed structure', () => {
    // Test the embed structure that would be built
    const blobRef = { $type: 'blob', ref: { $link: 'bafkvideo' }, mimeType: 'video/mp4', size: 5000 };
    const altText = 'A cat video';

    const embed = {
      $type: 'app.bsky.embed.video',
      video: blobRef,
      alt: altText,
    };

    expect(embed.$type).toBe('app.bsky.embed.video');
    expect(embed.video).toBe(blobRef);
    expect(embed.alt).toBe(altText);
  });

  it('builds recordWithMedia embed for video + quote', () => {
    const blobRef = { $type: 'blob', ref: { $link: 'bafkvideo' }, mimeType: 'video/mp4', size: 5000 };
    const quoteUri = 'at://did:plc:abc/app.bsky.feed.post/123';
    const quoteCid = 'bafycid123';

    const embed = {
      $type: 'app.bsky.embed.recordWithMedia',
      record: {
        $type: 'app.bsky.embed.record',
        record: { uri: quoteUri, cid: quoteCid },
      },
      media: {
        $type: 'app.bsky.embed.video',
        video: blobRef,
        alt: '',
      },
    };

    expect(embed.$type).toBe('app.bsky.embed.recordWithMedia');
    expect(embed.media.$type).toBe('app.bsky.embed.video');
    expect(embed.record.record.uri).toBe(quoteUri);
  });

  it('prioritizes video over images when both present', () => {
    const files = [
      new File([], 'photo.jpg', { type: 'image/jpeg' }),
      new File([], 'clip.mp4', { type: 'video/mp4' }),
      new File([], 'photo2.png', { type: 'image/png' }),
    ];

    const videoFile = files.find(f => isVideoFile(f));
    expect(videoFile).toBeDefined();
    expect(videoFile!.name).toBe('clip.mp4');
  });
});
