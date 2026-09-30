import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateOrganization from '../pages/organization/CreateOrganization';
import { api } from '../services/api';

const ORGANIZATION = {
  _id: '65b100000000000000000001',
  name: 'OPENCODE_TEST A11y Club',
  shortName: 'A11y',
  type: 'other',
  location: { city: '', area: '', address: '', country: '' },
  contact: { phone: '', email: '' },
  socialLinks: {},
  privacy: { contactInfo: 'public', socialLinks: 'public', location: 'public' },
};

function mockApi() {
  // The service layer uses axios, which goes through XMLHttpRequest rather than
  // fetch in jsdom, so swap the adapter instead of the global.
  api.defaults.adapter = async (config) => {
    const url = String(config.url || '');
    let data;
    if (url.includes('/team-categories')) data = [];
    else if (url.includes('/organizations/my')) data = [];
    else data = { organization: ORGANIZATION };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
}

describe('CreateOrganization field labels', () => {
  it('exposes a queryable label for every control on the form', () => {
    mockApi();
    localStorage.setItem(
      'bq_user',
      JSON.stringify({ _id: '65b1000000000000000000aa', emailVerified: true, accountType: 'organization_admin' })
    );
    localStorage.setItem('bq_token', 'test-token');

    render(
      <MemoryRouter>
        <CreateOrganization />
      </MemoryRouter>
    );

    // These resolve only if label/control are genuinely associated.
    for (const name of [
      'Name *',
      'Short name',
      'Website',
      'Sub-organization of',
      'About',
      'City',
      'Area',
      'Country',
      'Contact phone',
      'Public contact email',
    ]) {
      expect(screen.getByLabelText(name), `no label found for "${name}"`).toBeTruthy();
    }
  });
});

