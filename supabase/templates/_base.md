Email templates used by Supabase Auth (Dashboard → Authentication → Emails).
Plain tables and inline styles: Gmail, Outlook and Apple Mail all strip
stylesheets. Variables available: {{ .ConfirmationURL }}, {{ .Token }},
{{ .TokenHash }}, {{ .SiteURL }}, {{ .Email }}, {{ .RedirectTo }}.
