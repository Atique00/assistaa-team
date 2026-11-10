/* ====================================================================
 * Assistaa · forward to Supabase (10 Nov 2026)
 * Paste at the END of Code.gs in BOTH sheets' scripts, then rename the
 * older "function doPost(e)" above it to "function doPost_sheets(e)".
 * Any phone still running the old app keeps working: its requests are
 * passed to the new backend, which answers in the same format.
 * Rollback: delete this block and rename doPost_sheets back to doPost.
 * ==================================================================== */
const SUPABASE_API_ = 'https://zciuchdximmzwiisdkqu.supabase.co/functions/v1/team-api';

function doPost(e) {
  const team = isSupport_() ? 'support' : 'store';
  const body = (e && e.postData && e.postData.contents) || '{}';
  try {
    const r = UrlFetchApp.fetch(SUPABASE_API_ + '?team=' + team + '&forceFunctionRegion=ap-southeast-1', {
      method: 'post', contentType: 'text/plain', payload: body, muteHttpExceptions: true, followRedirects: true
    });
    return ContentService.createTextOutput(r.getContentText()).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Please close the app and open it again.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
