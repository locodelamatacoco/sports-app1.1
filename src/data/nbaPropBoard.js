// src/data/nbaPropBoard.js
//
// The full points-prop board for 2026-10-23, read off the scoresandodds game
// pages (the per-game pages, which serve the current fixture — the per-player
// pages serve a stale one).
//
// `line` and `price` are the book's. `theirProj` is scoresandodds' OWN
// projection, and it is here for exactly one purpose: as a SCREEN. Where their
// projection sits far from the line, that is a candidate worth researching a
// baseline for. It is never an input to our model and never our read — using it
// as a projection would just be echoing them with extra steps.
//
// A player only gets a modelled read once an independent 2025-26 baseline has
// been sourced for them (see PROP_SETS in nbaGames.js). The rest are listed so
// the board is complete and the screen can rank them.

export const PROP_BOARD_DATE = '2026-10-23';

export const POINTS_BOARD = [
  // CHI @ MIL — MIL -1.5, total 240.5
  { game: 'CHI@MIL', player: 'Tyler Herro', line: 22.5, over: -112, theirProj: 24.38 },
  { game: 'CHI@MIL', player: 'Norman Powell', line: 21.5, over: -112, theirProj: 18.73 },
  { game: 'CHI@MIL', player: 'Caleb Wilson', line: 17.5, over: -105, theirProj: 17.87 },
  { game: 'CHI@MIL', player: 'Ryan Rollins', line: 16.5, over: -110, theirProj: 17.0 },
  { game: 'CHI@MIL', player: 'Matas Buzelis', line: 16.5, over: -105, theirProj: 15.2 },
  { game: 'CHI@MIL', player: 'Jaime Jaquez', line: 15.5, over: -115, theirProj: 16.58 },
  { game: 'CHI@MIL', player: 'Josh Giddey', line: 13.5, over: -120, theirProj: 14.7 },
  { game: 'CHI@MIL', player: 'Jalen Smith', line: 11.5, over: -115, theirProj: 13.05 },
  { game: 'CHI@MIL', player: 'Myles Turner', line: 10.5, over: -120, theirProj: 12.61 },
  { game: 'CHI@MIL', player: 'Kyle Kuzma', line: 11.5, over: -105, theirProj: 11.43 },
  { game: 'CHI@MIL', player: 'Isaac Okoro', line: 5.5, over: -112, theirProj: 6.86 },

  // NY @ BOS — BOS -2.5, total 221.5
  { game: 'NY@BOS', player: 'Jayson Tatum', line: 25.5, over: -115, theirProj: 27.6 },
  { game: 'NY@BOS', player: 'Jalen Brunson', line: 24.5, over: -125, theirProj: 23.22 },
  { game: 'NY@BOS', player: 'Paul George', line: 18.5, over: -105, theirProj: 17.63 },
  { game: 'NY@BOS', player: 'Karl-Anthony Towns', line: 17.5, over: -130, theirProj: 17.88 },
  { game: 'NY@BOS', player: 'OG Anunoby', line: 15.5, over: -120, theirProj: 15.71 },
  { game: 'NY@BOS', player: 'Derrick White', line: 15.5, over: -120, theirProj: 15.95 },
  { game: 'NY@BOS', player: 'Payton Pritchard', line: 14.5, over: -120, theirProj: 15.94 },
  { game: 'NY@BOS', player: 'Mikal Bridges', line: 11.5, over: -112, theirProj: 11.34 },
  { game: 'NY@BOS', player: 'Josh Hart', line: 11.5, over: -115, theirProj: 10.74 },

  // ATL @ CHA — ATL -2.5, total 226.5
  { game: 'ATL@CHA', player: 'Brandon Miller', line: 24.5, over: -125, theirProj: 23.8 },
  { game: 'ATL@CHA', player: 'Jalen Johnson', line: 21.5, over: -120, theirProj: 21.53 },
  { game: 'ATL@CHA', player: 'Nickeil Alexander-Walker', line: 18.5, over: -115, theirProj: 19.68 },
  { game: 'ATL@CHA', player: 'Naz Reid', line: 17.5, over: -120, theirProj: 17.25 },
  { game: 'ATL@CHA', player: 'CJ McCollum', line: 15.5, over: -112, theirProj: 15.5 },
  { game: 'ATL@CHA', player: 'Dyson Daniels', line: 11.5, over: -105, theirProj: 12.87 },
  { game: 'ATL@CHA', player: 'Moussa Diabate', line: 9.5, over: -125, theirProj: 11.83 },
  { game: 'ATL@CHA', player: 'Luguentz Dort', line: 6.5, over: 100, theirProj: 8.32 },
  { game: 'ATL@CHA', player: "Royce O'Neale", line: 6.5, over: 105, theirProj: 8.12 },
  { game: 'ATL@CHA', player: 'Ryan Kalkbrenner', line: 4.5, over: 115, theirProj: 6.18 },

  // DAL @ IND — IND -7.5, total 240.5
  { game: 'DAL@IND', player: 'Pascal Siakam', line: 24.5, over: -112, theirProj: 21.18 },
  { game: 'DAL@IND', player: 'Cooper Flagg', line: 23.5, over: -120, theirProj: 23.27 },
  { game: 'DAL@IND', player: 'Tyrese Haliburton', line: 18.5, over: -112, theirProj: 18.91 },
  { game: 'DAL@IND', player: 'Kyrie Irving', line: 18.5, over: -120, theirProj: 18.29 },
  { game: 'DAL@IND', player: 'Ivica Zubac', line: 15.5, over: -105, theirProj: 17.75 },
  { game: 'DAL@IND', player: 'Andrew Nembhard', line: 15.5, over: 100, theirProj: 13.31 },
  { game: 'DAL@IND', player: 'Aaron Nesmith', line: 12.5, over: -112, theirProj: 14.79 },
  { game: 'DAL@IND', player: 'Obi Toppin', line: 11.5, over: 100, theirProj: 9.61 },
  { game: 'DAL@IND', player: 'Kelly Oubre', line: 9.5, over: -112, theirProj: 12.39 },

  // MIN @ ORL — ORL -1.5, total 234.5
  { game: 'MIN@ORL', player: 'Anthony Edwards', line: 29.5, over: -105, theirProj: 30.48 },
  { game: 'MIN@ORL', player: 'Paolo Banchero', line: 22.5, over: -104, theirProj: 25.17 },
  { game: 'MIN@ORL', player: 'Franz Wagner', line: 20.5, over: -115, theirProj: 19.49 },
  { game: 'MIN@ORL', player: 'LaMelo Ball', line: 19.5, over: -105, theirProj: 17.82 },
  { game: 'MIN@ORL', player: 'Desmond Bane', line: 18.5, over: -108, theirProj: 19.68 },
  { game: 'MIN@ORL', player: 'Jalen Suggs', line: 13.5, over: -105, theirProj: 12.74 },
  { game: 'MIN@ORL', player: 'Rudy Gobert', line: 9.5, over: -102, theirProj: 8.52 },

  // TOR @ WSH — TOR -8.5, total 236.5
  { game: 'TOR@WSH', player: 'Kawhi Leonard', line: 24.5, over: -115, theirProj: 23.87 },
  { game: 'TOR@WSH', player: 'Anthony Davis', line: 22.5, over: -112, theirProj: 24.15 },
  { game: 'TOR@WSH', player: 'Trae Young', line: 19.5, over: -110, theirProj: 20.57 },
  { game: 'TOR@WSH', player: 'RJ Barrett', line: 19.5, over: -110, theirProj: 18.51 },
  { game: 'TOR@WSH', player: 'Scottie Barnes', line: 18.5, over: -120, theirProj: 18.95 },
  { game: 'TOR@WSH', player: 'Immanuel Quickley', line: 16.5, over: 100, theirProj: 17.41 },
  { game: 'TOR@WSH', player: 'Bilal Coulibaly', line: 9.5, over: -130, theirProj: 10.48 },
  { game: 'TOR@WSH', player: 'Jakob Poeltl', line: 9.5, over: -115, theirProj: 10.63 },

  // DET @ MIA — DET -1.5, total 235.5
  { game: 'DET@MIA', player: 'Giannis Antetokounmpo', line: 28.5, over: -120, theirProj: 29.3 },
  { game: 'DET@MIA', player: 'Cade Cunningham', line: 24.5, over: -112, theirProj: 23.0 },
  { game: 'DET@MIA', player: 'Jalen Duren', line: 17.5, over: -110, theirProj: 17.02 },
  { game: 'DET@MIA', player: 'Bam Adebayo', line: 16.5, over: -125, theirProj: 16.96 },
  { game: 'DET@MIA', player: 'Andrew Wiggins', line: 12.5, over: -120, theirProj: 13.19 },
  { game: 'DET@MIA', player: 'Duncan Robinson', line: 10.5, over: -115, theirProj: 13.36 },
  { game: 'DET@MIA', player: 'Bobby Portis', line: 10.5, over: -125, theirProj: 12.97 },
  { game: 'DET@MIA', player: 'Ausar Thompson', line: 9.5, over: -125, theirProj: 11.21 },
  { game: 'DET@MIA', player: 'Pelle Larsson', line: 9.5, over: 100, theirProj: 7.76 },
  { game: 'DET@MIA', player: 'Paul Reed', line: 7.5, over: -130, theirProj: 10.14 },

  // HOU @ SA — SA -5.5, total 225.5
  { game: 'HOU@SA', player: 'Victor Wembanyama', line: 25.5, over: -105, theirProj: 27.66 },
  { game: 'HOU@SA', player: 'Kevin Durant', line: 24.5, over: 100, theirProj: 25.4 },
  { game: 'HOU@SA', player: 'Alperen Sengun', line: 17.5, over: -115, theirProj: 18.54 },
  { game: 'HOU@SA', player: 'Stephon Castle', line: 17.5, over: -110, theirProj: 16.68 },
  { game: 'HOU@SA', player: 'Dylan Harper', line: 16.5, over: -110, theirProj: 16.09 },
  { game: 'HOU@SA', player: 'Amen Thompson', line: 15.5, over: 100, theirProj: 16.59 },
  { game: 'HOU@SA', player: "De'Aaron Fox", line: 14.5, over: -115, theirProj: 14.74 },
  { game: 'HOU@SA', player: 'Jabari Smith', line: 13.5, over: -105, theirProj: 15.9 },
  { game: 'HOU@SA', player: 'Fred VanVleet', line: 11.5, over: -130, theirProj: 9.74 },

  // NO @ UTAH — UTAH -2.5, total 239.5
  { game: 'NO@UTAH', player: 'Lauri Markkanen', line: 21.5, over: -120, theirProj: 22.68 },
  { game: 'NO@UTAH', player: 'Keyonte George', line: 20.5, over: 100, theirProj: 19.46 },
  { game: 'NO@UTAH', player: 'Zion Williamson', line: 19.5, over: -120, theirProj: 23.18 },
  { game: 'NO@UTAH', player: 'Trey Murphy', line: 18.5, over: -125, theirProj: 16.02 },
  { game: 'NO@UTAH', player: 'Jaren Jackson', line: 17.5, over: -105, theirProj: 18.36 },
  { game: 'NO@UTAH', player: 'Dejounte Murray', line: 16.5, over: -112, theirProj: 17.97 },
  { game: 'NO@UTAH', player: 'Jeremiah Fears', line: 11.5, over: -145, theirProj: 13.87 },

  // MEM @ GS — GS -4.5, total 237.5
  { game: 'MEM@GS', player: 'Stephen Curry', line: 25.5, over: -105, theirProj: 25.61 },
  { game: 'MEM@GS', player: 'Ty Jerome', line: 21.5, over: -110, theirProj: 24.83 },
  { game: 'MEM@GS', player: 'Brandin Podziemski', line: 15.5, over: -112, theirProj: 15.55 },
  { game: 'MEM@GS', player: 'Cameron Boozer', line: 15.5, over: -112, theirProj: 15.23 },
  { game: 'MEM@GS', player: 'Jerami Grant', line: 14.5, over: -112, theirProj: 15.62 },
  { game: 'MEM@GS', player: 'Yaxel Lendeborg', line: 14.5, over: -105, theirProj: 12.13 },
  { game: 'MEM@GS', player: 'Georges Niang', line: 8.5, over: -105, theirProj: 5.89 },

  // LAC @ LAL — LAL -9.5, total 225.5
  { game: 'LAC@LAL', player: 'Luka Doncic', line: 31.5, over: -110, theirProj: 33.57 },
  { game: 'LAC@LAL', player: 'Darius Garland', line: 23.5, over: -110, theirProj: 24.82 },
  { game: 'LAC@LAL', player: 'Austin Reaves', line: 22.5, over: -112, theirProj: 23.09 },
  { game: 'LAC@LAL', player: 'Rui Hachimura', line: 16.5, over: -112, theirProj: 18.18 },
  { game: 'LAC@LAL', player: 'Walker Kessler', line: 14.5, over: -120, theirProj: 13.86 },
  { game: 'LAC@LAL', player: 'Isaiah Jackson', line: 8.5, over: -112, theirProj: 11.94 },

  // POR @ SAC — POR -9.5, total 232.5
  { game: 'POR@SAC', player: 'Deni Avdija', line: 21.5, over: -112, theirProj: 23.46 },
  { game: 'POR@SAC', player: 'Zach LaVine', line: 19.5, over: -110, theirProj: 24.38 },
  { game: 'POR@SAC', player: 'Damian Lillard', line: 19.5, over: -112, theirProj: 21.02 },
  { game: 'POR@SAC', player: 'Ja Morant', line: 17.5, over: -115, theirProj: 16.53 },
  { game: 'POR@SAC', player: 'Darius Acuff', line: 16.5, over: -120, theirProj: 21.04 },
  { game: 'POR@SAC', player: 'Domantas Sabonis', line: 16.5, over: -120, theirProj: 18.1 },
  { game: 'POR@SAC', player: 'Scoot Henderson', line: 10.5, over: -115, theirProj: 13.01 },
  { game: 'POR@SAC', player: "De'Andre Hunter", line: 11.5, over: 100, theirProj: 8.74 },
];

// Rank the board by how far the source's projection sits from the line. This
// says where to spend research effort, not what to bet.
export function screenBoard(board = POINTS_BOARD, { minGap = 2 } = {}) {
  return board
    .map((row) => ({ ...row, gap: row.theirProj - row.line }))
    .filter((row) => Math.abs(row.gap) >= minGap)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}
