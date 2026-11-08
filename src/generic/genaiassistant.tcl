# HammerDB AI Assistant: local read-only views over existing Jobs and Pipelines.
# No new execution endpoints, credentials, external model calls, or publication.
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

# Return only safe, minimal, previously existing job metadata. The client
# loads a specific completed summaryjson artifact through the existing Jobs route.
proc wapp-page-ai-jobs {} {
    wapp-mimetype application/json
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    set entries {}
    if {[catch {
        hdbjobs eval {
            SELECT jobid, db, bm, timestamp, profile_id
            FROM JOBMAIN
            WHERE lower(db) IN ('pg','postgresql','maria','mariadb','mysql','vsql','villagesql')
            ORDER BY timestamp DESC
            LIMIT 200
        } {
            if {![regexp {^[A-Za-z0-9_-]{8,64}$} $jobid]} continue
            switch -nocase -- $db {
                pg - postgresql {set clean_db pg}
                maria - mariadb {set clean_db maria}
                mysql {set clean_db mysql}
                vsql - villagesql {set clean_db vsql}
                default {continue}
            }
            set clean_bm [string map {TPC- TPROC-} [string toupper $bm]]
            if {$clean_bm ni {TPROC-C TPROC-H}} continue
            set clean_ts [regsub -all {[^A-Za-z0-9 :+._-]} $timestamp {}]
            set pid 0
            if {[string is integer -strict $profile_id] && $profile_id > 0} {
                set pid $profile_id
            }
            lappend entries [format {{"jobid":"%s","database":"%s","benchmark":"%s","profile_id":%s,"timestamp":"%s"}} $jobid $clean_db $clean_bm $pid $clean_ts]
        }
    }]} {
        wapp-reply-code {503 Service Unavailable}
        wapp-unsafe {{"jobs":[]}}
        return
    }
    wapp-unsafe [format {{"jobs":[%s]}} [join $entries ,]]
}

# Existing CI status and profile ID are sufficient for polling without touching
# the benchmark execution path. Never expose clone commands or config secrets.
proc wapp-page-ai-pipelines {} {
    wapp-mimetype application/json
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    set entries {}
    if {[catch {
        hdbjobs eval {
            SELECT ci_id, refname, dbprefix, pipeline, io_intensive,
                   profile_id, status, timestamp
            FROM JOBCI ORDER BY ci_id DESC LIMIT 100
        } {
            if {![string is integer -strict $ci_id] || $ci_id <= 0} continue
            if {![regexp {^[A-Za-z0-9._/-]{1,180}$} $refname]} continue
            switch -nocase -- $dbprefix {
                maria - pg - mysql - vsql {set clean_db [string tolower $dbprefix]}
                default {continue}
            }
            if {![regexp {^[A-Za-z_]{2,24}$} $status]} continue
            set clean_status [string toupper $status]
            set clean_pipeline [string tolower $pipeline]
            if {$clean_pipeline ne "profile"} continue
            set io [expr {$io_intensive eq "1" ? 1 : 0}]
            set pid 0
            if {[string is integer -strict $profile_id] && $profile_id > 0} {
                set pid $profile_id
            }
            set clean_ts [regsub -all {[^A-Za-z0-9 :+._-]} $timestamp {}]
            lappend entries [format {{"ci_id":%s,"database":"%s","refname":"%s","pipeline":"profile","io_intensive":%s,"profile_id":%s,"status":"%s","timestamp":"%s"}} $ci_id $clean_db $refname $io $pid $clean_status $clean_ts]
        }
    }]} {
        wapp-reply-code {503 Service Unavailable}
        wapp-unsafe {{"pipelines":[]}}
        return
    }
    wapp-unsafe [format {{"pipelines":[%s]}} [join $entries ,]]
}

proc wapp-page-ai-assistant {} {
    set B [wapp-param BASE_URL]
    wapp-mimetype {text/html; charset=utf-8}
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    wapp-reply-extra Referrer-Policy same-origin
    wapp-content-security-policy {default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'}
    wapp-subst {<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Assistant - HammerDB</title><link rel="stylesheet" href="%url($B/hdb-theme.css)"><link rel="stylesheet" href="%url($B/ai-assistant.css)"><script defer src="%url($B/hdb-theme.js)"></script><script defer src="%url($B/ai-assistant-core.js)"></script><script defer src="%url($B/ai-assistant.js)"></script></head><body>
    <p class="hdb-brand-logo"><img src="%url($B/logo.png)" alt="HammerDB" width="55"></p>
    <main class="hdb-page hdb-assistant-page" id="hdb-ai-app" data-base="%html($B)" tabindex="-1">
       <header class="hdb-service-header"><div class="hdb-service-nav">
          <a href="%url($B/jobs)">Jobs</a><a href="%url($B/pipelines)">Pipelines</a><a href="%url($B/ai-assistant)" aria-current="page">AI Assistant</a>
       </div><h1>AI Assistant</h1></header>
       <p class="hdb-ai-muted">Compare existing EC2 TPROC-C performance profiles for MariaDB, PostgreSQL, MySQL and VillageSQL, using actual HammerDB Jobs artifacts.</p>
       <section class="hdb-ai-panel" aria-label="Assistant conversation">
          <div id="hdb-ai-conversation" class="hdb-ai-conversation" role="log" aria-live="polite" aria-relevant="additions"></div>
          <form id="hdb-ai-form"><label for="hdb-ai-prompt">Your question</label>
             <textarea id="hdb-ai-prompt" rows="3" maxlength="4000" required placeholder="Run profiles on MariaDB, PostgreSQL, MySQL and VillageSQL, then compare results"></textarea>
             <div class="hdb-ai-actions"><button type="submit" id="hdb-ai-send">Send</button><span id="hdb-ai-status" role="status" aria-live="polite"></span></div>
          </form>
       </section>
       <section class="hdb-ai-panel" aria-labelledby="hdb-ai-queue-heading">
          <h2 id="hdb-ai-queue-heading">Profile sequence</h2>
          <p class="hdb-ai-muted">The assistant checks existing pipeline completion and moves to the next prepared step. Confirm each start in HammerDB Pipelines. No automatic run starts or hidden execution.</p>
          <div id="hdb-ai-queue"><p class="hdb-ai-muted">Ask to run two or more profiles to prepare a sequence.</p></div>
          <div class="hdb-ai-actions"><button type="button" id="hdb-ai-refresh">Check pipeline status</button><button type="button" id="hdb-ai-clear">Clear sequence</button></div>
       </section>
       <section class="hdb-ai-panel" aria-labelledby="hdb-ai-report-heading">
          <h2 id="hdb-ai-report-heading">Measured comparison</h2>
          <div id="hdb-ai-report"><p class="hdb-ai-muted">Ask to compare results from two to four databases, or use completed profile results.</p></div>
       </section>
       <section class="hdb-ai-panel" aria-labelledby="hdb-ai-sharing-heading">
          <h2 id="hdb-ai-sharing-heading">Share with TPC-OSS</h2>
          <p>Contributing reviewed results helps everyone compare real database performance. Share is recommended by default, but nothing is published without your review and a GitHub pull request.</p>
          <div id="hdb-ai-sharing"><a href="https://tpc-council.github.io/hammerdb-results/submit.html" target="_blank" rel="noopener noreferrer">Review and submit via GitHub</a></div>
       </section>
       <p class="hdb-ai-muted">EC2 only. This tab does not send artifacts to an AI provider or handle API keys. No RDS orchestration.</p>
    </main></body></html>}
}