# Install in a Google Sheet

Status: tested with the local Node harness (`npm test`) against the live exchange-rate API. It has not been run inside a real Google Sheet yet.

## 1. Prepare the Orders sheet

Your spreadsheet needs a tab named **Orders** with these headers in row 1 (any order, extra columns are ignored):

`Order ID | Order Date | Customer | Region | Product | Qty | Amount | Currency`

`Customer` is optional. `Amount` is the order total in the row's currency (USD, EUR, GBP, MAD, or any code the API knows).

To try it with the sample data: **File > Import > Upload** `sample-data/orders.csv`, choose **Insert new sheet(s)**,
**untick "Convert text to numbers, dates, and formulas"**, click **Import data**, then rename the new tab to `Orders`.
The script reads text dates and amounts itself. The local test run loaded the file the same way, as text.

Why untick: with it ticked, Sheets turns date text into date cells using the sheet's locale. In a US-locale sheet,
`05/09/2026` (5 September) becomes 9 May, with no warning, and the script cannot undo that because the cell is already a
date. If you prefer to keep it ticked, first set **File > Settings > Locale** to a day-first country such as United Kingdom.

## 2. Paste the script

1. In the spreadsheet: **Extensions > Apps Script**.
2. Click the gear (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
3. Back in the **Editor**, open `appsscript.json` and replace all of it with the content of `apps-script/appsscript.json`.
4. Delete the sample `Code.gs`, or empty it.
5. For each file in `apps-script/`, click **+ > Script**, type the name without `.gs` (the editor adds it), and paste the file:
   `Clean`, `Email`, `Fx`, `Menu`, `Report`, `Settings`, `Sheets`, `Summary`.
6. Click **Save** (Ctrl+S).
7. Go back to the spreadsheet tab and reload it. After a few seconds a **Reports** menu appears.

## 3. First run and authorization

1. **Reports > Run weekly report**.
2. Google asks for authorization: **Continue**, pick your account.
3. For a script you made yourself Google shows "Google hasn't verified this app": click **Advanced > Go to (project name)**.
4. Check the permissions and click **Allow**. The script asks only for these:
   - see and edit **this spreadsheet only** (`spreadsheets.currentonly`)
   - show the menu and pop-ups (`script.container.ui`)
   - connect to an external service, for the exchange rates (`script.external_request`)
   - send email as you, for the report (`script.send_mail`)
   - run when you are not present, for the weekly trigger (`script.scriptapp`)
5. Click **Reports > Run weekly report** again. It writes **Clean data**, **Issues**, **Summary** (with a chart) and **Run log**. Your **Orders** tab is never changed.

## 4. Set the owner email

The first run creates a **Settings** tab. Type your email in the **Value** cell of **Owner email**, then run the report again: the summary arrives in your inbox (from your own Gmail account).

Other settings in the same tab:

| Setting | Meaning |
|---|---|
| Send email | `Yes` or `No` |
| Text dates are | `DD/MM/YYYY` or `MM/DD/YYYY`, for dates stored as text. `YYYY-MM-DD` text always works. Real date cells are used as they are: Sheets has already decided the day and month. |
| Report week ending | Blank = the last full week (Monday to Sunday). Or a date, to re-run the week that contains it. |

Report weeks use the spreadsheet's time zone (**File > Settings > Time zone**).

## 5. Install the weekly trigger

**Reports > Install weekly trigger**. The report then runs every **Monday between 7 and 8 am** (spreadsheet time zone) and emails the owner. Installing twice still leaves one trigger. To check it: Apps Script editor > **Triggers** (clock icon). To stop it: **Reports > Remove weekly trigger**.

## If something goes wrong

- Every run adds a row to **Run log** (status, rows read, issues, rates used, email sent to, seconds, note).
- If a run fails, the owner gets an error email with the reason.
- If the exchange-rate API is down, the last good rates (up to 7 days old) are used and the email says so. With no usable rates the run stops before changing any sheet.
- "There is no sheet named Orders": rename your orders tab to `Orders`.
- "Missing column(s)": check the headers in row 1.
- Google's script email quota for free Gmail accounts is 100 recipients a day; this report sends one email per run.
- Full error details: Apps Script editor > **Executions**.
