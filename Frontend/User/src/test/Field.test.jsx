import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from '../pages/organization/orgStyles';

describe('Field label association', () => {
  it('associates a label with a text input via htmlFor/id', () => {
    render(
      <Field label="Team name *">
        <input defaultValue="" />
      </Field>
    );
    // getByLabel only resolves when the association is real.
    expect(screen.getByLabelText('Team name *')).toBeTruthy();
  });

  it('associates a label with a select', () => {
    render(
      <Field label="Format">
        <select defaultValue="T20" />
      </Field>
    );
    expect(screen.getByLabelText('Format')).toBeTruthy();
  });

  it('associates a label with a textarea', () => {
    render(
      <Field label="About">
        <textarea defaultValue="" />
      </Field>
    );
    expect(screen.getByLabelText('About')).toBeTruthy();
  });

  it('gives two Fields distinct ids so neither steals the other', () => {
    render(
      <>
        <Field label="City">
          <input defaultValue="" />
        </Field>
        <Field label="Area">
          <input defaultValue="" />
        </Field>
      </>
    );
    const city = screen.getByLabelText('City');
    const area = screen.getByLabelText('Area');
    expect(city.id).toBeTruthy();
    expect(city.id).not.toBe(area.id);
  });

  it('keeps a caller-supplied id', () => {
    render(
      <Field label="Name" hint="Shown in lists.">
        <input id="team-name" defaultValue="" />
      </Field>
    );
    const control = screen.getByLabelText('Name');
    expect(control.id).toBe('team-name');
  });

  it('wires a hint up with aria-describedby', () => {
    render(
      <Field label="Name" hint="Shown in lists.">
        <input defaultValue="" />
      </Field>
    );
    const control = screen.getByLabelText('Name');
    const described = control.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described).textContent).toContain('Shown in lists.');
  });

  it('labels a group of buttons as a group rather than pointing for at a div', () => {
    render(
      <Field label="Roles they will get" hint="Owner, manager">
        <div>
          <button type="button">Manager</button>
        </div>
      </Field>
    );
    const group = screen.getByRole('group', { name: 'Roles they will get' });
    expect(group).toBeTruthy();
  });
});
