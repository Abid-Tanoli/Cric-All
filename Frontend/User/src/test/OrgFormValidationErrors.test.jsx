import React from 'react';
import { beforeEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateOrganization from '../pages/organization/CreateOrganization';
import OrgSettings from '../pages/organization/OrgSettings';
import { api } from '../services/api';

const ORG_ID = '65b100000000000000000001';

const validationError = (data, config) => ({
  config,
  response: { status: 400, statusText: 'Bad Request', headers: {}, config, data },
});

function mockApiFailure(errors) {
  api.defaults.adapter = async (config) => {
    const url = String(config.url || '');
    if (url.includes('/organizations/my')) {
      return { data: [], status: 200, statusText: 'OK', headers: {}, config };
    }
    if (url.includes('/organizations') && String(config.method || 'get').toLowerCase() === 'post') {
      throw validationError({ message: 'Validation failed', errors }, config);
    }
    if (url.includes(`/organizations/${ORG_ID}`) && String(config.method || 'get').toLowerCase() === 'put') {
      throw validationError({ message: 'Validation failed', errors }, config);
    }
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
}

describe('organization form validation details', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'bq_user',
      JSON.stringify({ _id: '65b1000000000000000000aa', emailVerified: true })
    );
    localStorage.setItem('bq_token', 'test-token');
  });

  it('shows the failing message under the matching field on CreateOrganization', async () => {
    mockApiFailure([
      { code: 'invalid_format', path: ['contact', 'email'], message: 'Please use a valid email format' },
      { code: 'too_big', path: ['shortName'], message: 'Short name is too long' },
      {
        code: 'unrecognized_keys',
        path: [],
        keys: ['locationRefs'],
        message: 'Unrecognized keys: "locationRefs"',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/organization/new?orgType=local_club']}>
        <CreateOrganization />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Eagle Eleven' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Please use a valid email format')).toBeTruthy();
    expect(screen.getByLabelText('Public contact email')).toHaveAccessibleDescription(
      'Please use a valid email format'
    );
    expect(screen.getByLabelText('Short name')).toHaveAccessibleDescription(
      /Short name is too long/
    );
    expect(screen.getByText('Unrecognized keys: "locationRefs"')).toBeTruthy();
  });

  it('shows the failing message under the matching field on OrgSettings', async () => {
    mockApiFailure([
      { code: 'too_big', path: ['shortName'], message: 'Short name is too long' },
      {
        code: 'unrecognized_keys',
        path: [],
        keys: ['locationLabels'],
        message: 'Unrecognized keys: "locationLabels"',
      },
    ]);

    const org = {
      _id: ORG_ID,
      name: 'Eagle Eleven',
      shortName: 'Eagle 11',
      type: 'club',
      orgType: 'local_club',
      location: { city: '', area: '', address: '', country: '' },
      contact: { phone: '', email: '' },
      socialLinks: {},
      privacy: { contactInfo: 'public', socialLinks: 'public', location: 'public' },
    };

    render(
      <MemoryRouter>
        <OrgSettings org={org} access={{ permissions: ['manage_org'] }} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Short name is too long')).toBeTruthy();
    expect(screen.getByLabelText('Short name')).toHaveAccessibleDescription(
      /Short name is too long/
    );
    expect(screen.getByText('Unrecognized keys: "locationLabels"')).toBeTruthy();
  });
});
