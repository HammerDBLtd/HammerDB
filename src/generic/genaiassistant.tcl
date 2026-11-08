# HammerDB AI Assistant routes. Read-only; no API key handling or new
# benchmark execution. Existing jobs/pipelines remain authoritative.
namespace eval ::hdb_ai {}

proc ::hdb_ai::asset {name mime} {
    if {$name ni {ai-assistant-core.js ai-assistant.js ai-assistant.css}} {
        wapp-reply-code {404 Not Found}
        return
    }
    set path [file join $::UserDefaultDir src webservice $name]
    if {![file isfile $path] || ![file readable $path]} {
        wapp-reply-code {404 Not Found}
        wapp-mimetype {text/plain; charset=utf-8}
        wapp-unsafe {Asset unavailable}
        return
    }
    set f [open $path r]
    fconfigure $f -encoding utf-8 -translation lf
    set data [read $f]
    close $f
    wapp-mimetype $mime
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    wapp-unsafe $data
}

proc wapp-page-ai-assistant-core.js {} {
    ::hdb_ai::asset ai-assistant-core.js {text/javascript; charset=utf-8}
}
proc wapp-page-ai-assistant.js {} {
    ::hdb_ai::asset ai-assistant.js {text/javascript; charset=utf-8}
}
proc wapp-page-ai-assistant.css {} {
    ::hdb_ai::asset ai-assistant.css {text/css; charset=utf-8}
}

# Only public job metadata already available through the Jobs page. Never
# include configuration, hostnames, SQL, credentials, logs, or result bodies.
proc wapp-page-ai-jobs {} {
    wapp-mimetype application/json
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    set entries {}
    if {[catch {
        hdbjobs eval {
            SELECT jobid, db, bm, timestamp
            FROM JOBMAIN
            WHERE lower(db) IN ('pg','postgresql','maria','mariadb')
            ORDER BY timestamp DESC
            LIMIT 100
        } {
            if {![regexp {^[A-Za-z0-9_-]{8,64}$} $jobid]} continue
            switch -nocase -- $db {
                pg - postgresql {set clean_db pg}
                maria - mariadb {set clean_db maria}
                default {continue}
            }
            set clean_bm [string map {TPC- TPROC-} [string toupper $bm]]
            if {$clean_bm ni {TPROC-C TPROC-H}} continue
            set clean_ts [regsub -all {[^A-Za-z0-9 :+._-]} $timestamp {}]
            lappend entries [format {{"jobid":"%s","database":"%s","benchmark":"%s","timestamp":"%s"}} $jobid $clean_db $clean_bm $clean_ts]
        }
    }]} {
        wapp-reply-code {503 Service Unavailable}
        wapp-unsafe {{"jobs":[]}}
        return
    }
    wapp-unsafe [format {{"jobs":[%s]}} [join $entries ,]]
}

proc wapp-page-ai-assistant {} {
    set B [wapp-param BASE_URL]
    wapp-mimetype {text/html; charset=utf-8}
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    wapp-reply-extra Referrer-Policy no-referrer
    wapp-content-security-policy {default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'}
    wapp-subst {<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Assistant - HammerDB</title><link rel="stylesheet" href="%url($B/hdb-theme.css)"><link rel="stylesheet" href="%url($B/ai-assistant.css)"><script defer src="%url($B/hdb-theme.js)"></script><script defer src="%url($B/ai-assistant-core.js)"></script><script defer src="%url($B/ai-assistant.js)"></script></head><body>
    <p class="hdb-brand-logo"><img src="%url($B/logo.png)" alt="HammerDB" width="55"></p>
    <main class="hdb-page hdb-assistant-page" id="hdb-ai-app" data-base="%html($B)" tabindex="-1">
       <header class="hdb-service-header"><div class="hdb-service-nav">
          <a href="%url($B/jobs)">Jobs</a><a href="%url($B/pipelines)">Pipelines</a><a href="%url($B/ai-assistant)" aria-current="page">AI Assistant</a>
       </div><h1>AI Assistant</h1></header>
       <p class="hdb-ai-muted">Compare measured PostgreSQL and MariaDB benchmark results. Use the existing Pipelines page to start profiles, then share reviewed results through TPC-OSS.</p>
       <section class="hdb-ai-panel" aria-label="Assistant conversation">
          <div id="hdb-ai-conversation" class="hdb-ai-conversation" role="log" aria-live="polite" aria-relevant="additions"></div>
          <form id="hdb-ai-form"><label for="hdb-ai-prompt">Your question</label>
             <textarea id="hdb-ai-prompt" rows="3" maxlength="4000" required placeholder="Please compare PostgreSQL to MariaDB"></textarea>
             <div class="hdb-ai-actions"><button type="submit" id="hdb-ai-send">Send</button><span id="hdb-ai-status" role="status" aria-live="polite"></span></div>
          </form>
       </section>
       <section class="hdb-ai-panel" aria-labelledby="hdb-ai-report-heading">
          <h2 id="hdb-ai-report-heading">Measured comparison</h2>
          <div id="hdb-ai-report"><p class="hdb-ai-muted">Ask to compare the latest available TPROC-C results, or name two job IDs.</p></div>
       </section>
       <section class="hdb-ai-panel" aria-labelledby="hdb-ai-sharing-heading">
          <h2 id="hdb-ai-sharing-heading">Share with TPC-OSS</h2>
          <p>Sharing helps other users compare verified measurements. Review each JSON artifact before submitting: it may contain system information. Nothing is published automatically.</p>
          <div id="hdb-ai-sharing"><a href="https://tpc-council.github.io/hammerdb-results/submit.html" target="_blank" rel="noopener noreferrer">Open TPC-OSS submission page (GitHub sign-in required)</a></div>
       </section>
       <p class="hdb-ai-muted">This version uses local, measured job data only. It does not send results to an AI provider, use API keys or start benchmarks without confirmation.</p>
    </main></body></html>}
}
