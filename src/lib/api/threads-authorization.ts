/** Validate the response before exchanging a Threads authorization code. */
export function threadsAuthorizationCode(query: string, expectedState: string): string {
  const params = new URLSearchParams(query);
  if (!expectedState || params.get('state') !== expectedState) throw new Error('Threads sign-in state mismatch. Please try again.');
  if (params.has('error')) throw new Error(`Threads authorization denied: ${params.get('error')}`);
  const code = params.get('code');
  if (!code) throw new Error('No authorization code returned by Threads.');
  return code;
}
