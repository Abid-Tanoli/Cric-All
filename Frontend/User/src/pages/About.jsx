import React from "react";
import { Link } from "react-router-dom";

/** Plain-English About page for search and AdSense review. */
export default function About() {
  return (
    <div className="min-h-screen bg-cric-bg text-cric-text">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-black font-raj sm:text-4xl">About CricAll</h1>
        <p className="mt-2 text-sm text-cric-muted">
          Live scoring and match tracking for local cricket in Pakistan.
        </p>

        <div className="mt-8 space-y-7 text-sm leading-relaxed sm:text-base">
          <section>
            <h2 className="mb-2 text-lg font-black">What CricAll is</h2>
            <p className="text-cric-muted">
              CricAll is a live scoring and match-tracking platform for local
              cricket clubs and tournaments in Pakistan. It gives clubs, schools,
              academies and organizers a simple place to run their own matches,
              manage tournaments and record scores while a game is being played.
              Each match can have a public scorecard, and each tournament can
              have its own page with fixtures, results and team information.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Who it is for</h2>
            <p className="text-cric-muted">
              CricAll is for the people who make local cricket work. Clubs use
              it to keep their teams and matches in one place. Players can find
              their team and follow their performances. Scorers can enter runs,
              wickets and overs as the game moves. Fans and families can open a
              public page and follow a match without creating an account.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">How it works</h2>
            <ol className="list-decimal space-y-2 pl-5 text-cric-muted">
              <li>An organization or club is added on CricAll and creates its teams.</li>
              <li>The club sets up a match or tournament with fixtures and teams.</li>
              <li>A scorer records runs, wickets, overs and the final result.</li>
              <li>Public scorecards and tournament pages update for players and fans.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-black">Our aim</h2>
            <p className="text-cric-muted">
              The aim is simple: make local cricket easier to follow and easier
              to record. We do not publish invented scores or claims. The
              information shown on CricAll comes from the clubs and
              organizations that run the matches, and it should be read as their
              record of the game. We also keep the pages simple so they load
              quickly on a phone.
            </p>
            <p className="mt-3 text-cric-muted">
              If you want to know more or have a question, please use our{" "}
              <Link className="font-bold text-cric-accent underline" to="/contact">
                Contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
