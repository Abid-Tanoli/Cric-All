import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom';
import OrgTypeFilter, { orgTypeFromSearchParams } from '../components/OrgTypeFilter';

function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

function SelectedProbe() {
  const [params] = useSearchParams();
  return <output data-testid="value">{orgTypeFromSearchParams(params)}</output>;
}

describe('shared organization-type filter', () => {
  it('defaults to All types and persists a validated value in the URL', () => {
    render(
      <MemoryRouter initialEntries={['/teams?city=Lahore']}>
        <OrgTypeFilter />
        <UrlProbe />
      </MemoryRouter>
    );

    const select = screen.getByLabelText('Organization type');
    expect(select).toHaveValue('all');
    fireEvent.change(select, { target: { value: 'school' } });
    expect(screen.getByTestId('url').textContent).toContain('orgType=school');
    expect(screen.getByTestId('url').textContent).toContain('city=Lahore');
    fireEvent.change(select, { target: { value: 'all' } });
    expect(screen.getByTestId('url').textContent).not.toContain('orgType');
  });

  it('reads only valid values from a comma list', () => {
    const params = new URLSearchParams('orgType=school,not_a_type,local_club');
    render(
      <MemoryRouter>
        <SelectedProbe />
      </MemoryRouter>
    );
    expect(orgTypeFromSearchParams(params)).toBe('school,local_club');
  });
});
