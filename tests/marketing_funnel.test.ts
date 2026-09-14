import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as submitPilotRequest } from '../src/app/api/pilot-request/route';
import { getDb } from '../src/lib/db';

describe('Design partner application funnel', () => {
  test('stores a consented pilot application without requiring workspace authentication', async () => {
    const email = `pilot-${Date.now()}@example.com`;
    const request = new NextRequest('http://localhost:3010/api/pilot-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': `test-${Date.now()}` },
      body: JSON.stringify({
        name: 'Asha Mehta',
        email,
        organizationName: 'Mehta and Co',
        customerProfile: 'CA firm',
        clientVolume: '11–50 client books',
        message: 'We need a tighter reconciliation review process.',
        consent: true
      })
    });

    const response = await submitPilotRequest(request);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);

    const db = await getDb();
    const stored = await db.query('SELECT name, organization_name, customer_profile FROM pilot_requests WHERE email = $1;', [email]);
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].name, 'Asha Mehta');
    assert.equal(stored.rows[0].organization_name, 'Mehta and Co');
    assert.equal(stored.rows[0].customer_profile, 'CA firm');
  });

  test('requires explicit consent before storing an application', async () => {
    const request = new NextRequest('http://localhost:3010/api/pilot-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': `test-${Date.now()}` },
      body: JSON.stringify({
        name: 'Asha Mehta',
        email: 'no-consent@example.com',
        organizationName: 'Mehta and Co',
        customerProfile: 'CA firm',
        clientVolume: '11–50 client books',
        consent: false
      })
    });

    const response = await submitPilotRequest(request);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /confirm/i);
  });
});
