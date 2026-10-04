# interest-calculator

Interest calculator with four situations: a loan (monthly payment and total cost), savings or investments (growth with deposits, compounding and inflation), paying off a debt at a fixed payment, and finding the real yearly rate of a loan offer from its payment and fees.

- `logic.js`: the maths, month by month, with no DOM access (tested in `tests/unit/interest-calculator.test.js`).
- `app.js`: fields, results, chart and tables.
- `strings.js`: every visible string, keyed without the tool prefix and prefixed on export.

Saved locally: the chosen situation and the text typed in each field (`sloppify:interest-calculator:mode`, `:inputs`, schema version 1).

License: MIT (see the repository root).
