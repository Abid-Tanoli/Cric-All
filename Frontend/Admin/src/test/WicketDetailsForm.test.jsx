import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WicketDetailsForm from '../components/ScoreManagement/WicketDetailsForm';

const battingXI = [
  { _id: 'p1', name: 'Striker Sam' },
  { _id: 'p2', name: 'Non Nia' },
  { _id: 'p3', name: 'Next Ned' },
];
const bowlingXI = [{ _id: 'b1', name: 'Bowler Bob' }];
const innings = { wickets: 1, batting: [] };

function Harness({ initialWicket = 'run out', onConfirm = vi.fn() }) {
  const [selectedWicket, setSelectedWicket] = useState(initialWicket);
  const [setupState, setSetupState] = useState({
    wicketNewBatter: 'p3',
    wicketFielder: 'b1',
    wicketDismissedPlayer: 'striker',
    wicketDidCross: false,
    wicketRuns: 0,
  });

  return (
    <WicketDetailsForm
      selectedWicket={selectedWicket}
      setSelectedWicket={setSelectedWicket}
      setupState={setupState}
      setSetupState={setSetupState}
      battingXI={battingXI}
      bowlingXI={bowlingXI}
      curInn={innings}
      strikerId="p1"
      nonStrikerId="p2"
      onConfirm={() => onConfirm(setupState)}
      showToast={vi.fn()}
    />
  );
}

describe('WicketDetailsForm', () => {
  it('collects who is out, whether the batters crossed, and completed runs for a run-out', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const whoIsOut = screen.getByLabelText('Who Is Out');
    expect(whoIsOut).toHaveValue('striker');
    expect(screen.getByRole('option', { name: 'Non Nia (Non-Striker)' })).toBeInTheDocument();

    fireEvent.change(whoIsOut, { target: { value: 'nonStriker' } });
    fireEvent.click(screen.getByLabelText('Batters Crossed'));
    fireEvent.change(screen.getByLabelText('Runs Completed Before Run Out'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Confirm Wicket Details'));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      wicketDismissedPlayer: 'nonStriker',
      wicketDidCross: true,
      wicketRuns: 2,
    }));
  });

  it('hides the run-out fields for a bowler dismissal', () => {
    render(<Harness initialWicket="caught" />);

    expect(screen.queryByLabelText('Who Is Out')).toBeNull();
    expect(screen.queryByLabelText('Batters Crossed')).toBeNull();
    expect(screen.queryByLabelText('Runs Completed Before Run Out')).toBeNull();
    expect(screen.getByLabelText('Fielder Involved')).toBeInTheDocument();
  });
});
