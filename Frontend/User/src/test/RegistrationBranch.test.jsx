import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegistrationBranch from '../components/RegistrationBranch';

describe('registration branching screen', () => {
  it('offers six bilingual, tappable cards and reports the selection', () => {
    const onSelect = vi.fn();
    render(<RegistrationBranch onSelect={onSelect} />);

    const cards = screen.getAllByRole('button', { name: / \/ / });
    expect(cards).toHaveLength(6);
    expect(screen.getByText('آپ کیا رجسٹر کر رہے ہیں؟')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Player / کھلاڑی' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Foundation / NGO / فاؤنڈیشن / این جی او' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Local club / مقامی کلب' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'local_club', orgType: 'local_club' }));
  });
});
