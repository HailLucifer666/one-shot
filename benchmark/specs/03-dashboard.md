# Spec 03: Sales dashboard

Build a dashboard from the CSV described below. Data: columns date, region, product, units, revenue; about 500 rows you generate with a script, clearly marked as sample data.

## Requirements
- KPI cards: total revenue, total units, average revenue per unit.
- Line chart of revenue by month; bar chart of revenue by region.
- Filter by region and by date range; all charts and KPIs update.
- Table of the underlying rows with sorting by any column.

## Acceptance criteria (yes or no)
1. Page loads with no console errors.
2. KPI values equal the sums computed independently from the CSV.
3. Both charts render with labeled axes and a title.
4. Region filter changes every chart, KPI and the table.
5. Date range filter works and handles an empty result with a clear message.
6. Table sorts ascending and descending on each column.
7. Responsive at 360 and 1280 px without sideways page scroll.
8. Sample data is labeled as sample on the page.
9. Chart colors are distinguishable and text has at least 4.5:1 contrast.
10. A test or script verifies the KPI math.
