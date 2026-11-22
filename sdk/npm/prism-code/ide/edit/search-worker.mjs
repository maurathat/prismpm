// The search for a request that breaks a guarantee, in a worker.
//
// The search tries every request in the table's bounds, up to 200000 for each guarantee. Done in the page it holds
// the page still for as long as it takes, and a key pressed in the terminal waits for it. Here it holds nothing.
//
// Messages in:  { id, table, guarantees }   the table as rule-table.mjs reads it, and the guarantees to try
// Messages out: { id, found }               one { request, answer, checked } for each guarantee, in order
//               { id, error }               when the search itself failed

import { counterexample } from './prism-code/journey/rule-table.mjs';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, found: data.guarantees.map((guarantee) => counterexample(data.table, guarantee)) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error) });
  }
};
