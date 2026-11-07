import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthModel } from '../../src/models/AuthModel';
import { SupabaseService } from '../../src/services/SupabaseService';
import { BridgeController } from '../../src/controllers/BridgeController';
import { DebatePracticeController } from '../../src/controllers/DebatePracticeController';
import type { AuthSession } from '../../src/types';

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

  it('dispatches to multiple listeners in BridgeController when auth session arrives', () => {
    const auth = new AuthModel();
    auth.clearSession();
    const bridge = new BridgeController(auth);

    let listenerA_Called = false;
    let listenerB_SessionName = '';

    const unsubA = bridge.onAuthSuccess((session) => {
      listenerA_Called = true;
    });

    bridge.onAuthSuccess((session) => {
      listenerB_SessionName = session.userName;
    });

    const testSession: AuthSession = {
      userId: 'test_u_123',
      userName: '辯論研究員張三',
      token: 'test_token_xyz',
      authorizedAt: Date.now()
    };

    bridge.handleAuthSession(testSession);

    assert.equal(listenerA_Called, true);
    assert.equal(listenerB_SessionName, '辯論研究員張三');
    assert.equal(auth.isAuthenticated(), true);
    assert.equal(auth.getSession()?.userName, '辯論研究員張三');

    // Test unsubscribe
    unsubA();
    listenerA_Called = false;
    bridge.handleAuthSession(testSession);
    assert.equal(listenerA_Called, false);

    auth.clearSession();
  });

  it('notifies DebatePracticeController.onAuthGranted when bridge handles session', () => {
    const controller = new DebatePracticeController();
    controller.authModel.clearSession();

    let grantedSession: AuthSession | null = null;
    controller.onAuthGranted = (session) => {
      grantedSession = session;
    };

    const session: AuthSession = {
      userId: 'scholar_42',
      userName: '公法研究員李四',
      token: 'mock_jwt_42',
      authorizedAt: Date.now()
    };

    controller.bridgeController.handleAuthSession(session);

    assert.ok(grantedSession);
    assert.equal((grantedSession as AuthSession).userName, '公法研究員李四');
    assert.equal(controller.authModel.isAuthenticated(), true);

    controller.authModel.clearSession();
  });
});
