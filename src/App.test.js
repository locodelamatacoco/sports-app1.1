import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';

// The home route fetches scores and news on mount; stub the network so the
// shell renders deterministically and no request leaves the test run.
jest.mock('axios');

beforeEach(() => {
  axios.get.mockResolvedValue({ data: { articles: [], events: [] } });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the app shell with its brand', async () => {
  render(<App />);
  expect(await screen.findByRole('link', { name: /overtime/i })).toBeInTheDocument();
});

test('navigation exposes every top-level route', async () => {
  render(<App />);
  await waitFor(() => expect(axios.get).toHaveBeenCalled());

  const expected = [
    [/^home$/i, '/'],
    [/^scores$/i, '/scores'],
    [/^social$/i, '/social'],
    [/^standings$/i, '/standings'],
    [/^polls$/i, '/polls'],
    [/^ufc model$/i, '/ufc-model'],
    [/^nba model$/i, '/nba-model'],
  ];

  expected.forEach(([name, href]) => {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });
});

// The PRD is a static file in public/, so it is served from the site root.
// Both nav links previously pointed elsewhere and 404'd in production.
test('the PRD link points at the file as it is actually served', async () => {
  render(<App />);
  const prd = await screen.findByRole('link', { name: /^prd$/i });
  expect(prd).toHaveAttribute('href', '/OVERTIME-PRD.md');
});
