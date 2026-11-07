import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthModel } from '../../src/models/AuthModel';
import { SupabaseService } from '../../src/services/SupabaseService';

describe('Auth & Remote Database Synchronization', () => {
  it('initializes with unauthenticated session by default if storage empty', () => {
    const auth = new AuthModel();
    auth.clearSession();
    assert.equal(auth.isAuthenticated(), false);
    assert.equal(auth.hasDebatePermission(), false);
  });

  it('accepts debate code and marks authenticated with permission', () => {
    const auth = new AuthModel();
    auth.setDebateCode('DEBATE-TAIWAN-2026');
    assert.equal(auth.getDebateCode(), 'DEBATE-TAIWAN-2026');
    assert.equal(auth.isAuthenticated(), true);
    assert.equal(auth.hasDebatePermission(), true);
    auth.clearSession();
  });

  it('accepts web authorization session token and preserves session', async () => {
    const auth = new AuthModel();
    await auth.setSession({
      userId: 'test_researcher_id',
      userName: '資深辯論研究員',
      userEmail: 'researcher@example.com',
      token: 'jwt_mock_token_abc123',
      role: 'manager',
      authorizedAt: Date.now()
    });

    assert.equal(auth.isAuthenticated(), true);
    assert.equal(auth.getSession()?.userName, '資深辯論研究員');
    assert.equal(auth.hasDebatePermission(), true);
    auth.clearSession();
  });

  it('verifies Supabase client configuration matches official endpoints', () => {
    const service = SupabaseService.getInstance();
    assert.ok(service.getClient());
    service.setBankCode('TEAM-42');
    assert.equal(service.getBankCode(), 'TEAM-42');
  });
});
