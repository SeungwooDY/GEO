// Shared mode definitions. Order is top -> bottom in the side toggle.
export const ORDER = ['amplify', 'mirror', 'cloak']

export const MODES = {
  amplify: {
    label: 'Amplify',
    tag: 'Full exposure',
    line: 'AI is given the clearest, most complete version of your page. Structured, quotable, built to be cited.',
    openness: 1,      // iris wide open
  },
  mirror: {
    label: 'Mirror',
    tag: 'Reflected',
    line: 'AI sees exactly what a person sees. An accurate, faithful reflection of your page. No more, no less.',
    openness: 0.52,   // iris half open
  },
  cloak: {
    label: 'Cloak',
    tag: 'Closed',
    line: 'Your site goes invisible to AI. Nothing is served, and nothing is retained.',
    openness: 0.08,   // iris shut
  },
}
