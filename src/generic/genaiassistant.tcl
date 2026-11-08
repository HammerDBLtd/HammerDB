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
            if {![regexp {^[A-Za-z_ ]{2,40}$} $status]} continue
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
       <p class="hdb-ai-muted">Run and compare existing TPROC-C performance profiles for MariaDB, PostgreSQL, MySQL and VillageSQL, using actual HammerDB Jobs artifacts.</p>
       <section class="hdb-ai-panel" aria-label="Assistant conversation">
          <label for="hdb-ai-key">Your OpenAI API key (optional until you ask for AI analysis)</label>
          <div class="hdb-ai-actions"><input id="hdb-ai-key" type="password" autocomplete="off" spellcheck="false" maxlength="256" placeholder="Paste your own key; never stored"><button id="hdb-ai-key-clear" type="button">Clear key</button></div>
          <p class="hdb-ai-muted">The key stays in this tab only. For a remote Web Service, use HTTPS; localhost is also supported. No HammerDB-supplied key or fallback.</p>
          <div id="hdb-ai-conversation" class="hdb-ai-conversation" role="log" aria-live="polite" aria-relevant="additions"></div>
          <form id="hdb-ai-form"><label for="hdb-ai-prompt">Your question</label>
             <textarea id="hdb-ai-prompt" rows="3" maxlength="4000" required placeholder="Run profiles on MariaDB, PostgreSQL, MySQL and VillageSQL, then compare results"></textarea>
             <div class="hdb-ai-actions"><button type="submit" id="hdb-ai-send">Send</button><span id="hdb-ai-status" role="status" aria-live="polite"></span></div>
          </form>
       </section>
       <section class="hdb-ai-panel" aria-labelledby="hdb-ai-queue-heading">
          <h2 id="hdb-ai-queue-heading">Profile sequence</h2>
          <p class="hdb-ai-muted">Approve the whole sequence once. The assistant then starts each profile via the existing Pipelines interface and checks completion before starting the next. No new benchmark runner.</p>
          <div id="hdb-ai-queue"><p class="hdb-ai-muted">Ask to run two or more profiles to prepare a sequence.</p></div>
          <div class="hdb-ai-actions"><button type="button" id="hdb-ai-run-all">Approve and run sequence</button><button type="button" id="hdb-ai-refresh">Check pipeline status</button><button type="button" id="hdb-ai-clear">Clear sequence</button></div>
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
       <p class="hdb-ai-muted">Runs existing HammerDB pipelines on the configured host (local or EC2). Phase 1 covers existing open-source databases; RDS is outside this tab. AI receives only a short, filtered benchmark summary when enabled; never the original artifact or API key.</p>
    </main></body></html>}
}


# BYOK OpenAI response: a per-request proxy only. The API key is passed in the
# POST body, never stored in the database, HTML, JavaScript, files or logs.
# All requests go only to the fixed OpenAI endpoint using validated TLS.
proc ::hdb_ai::json_quote {value} {
    set out "\""
    foreach ch [split $value ""] {
        scan $ch %c n
        switch -- $n {
            34 {append out {\"}}
            92 {append out {\\}}
            10 {append out {\n}}
            13 {append out {\r}}
            9  {append out {\t}}
            default {
                if {$n < 32} {
                    append out [format {\\u%04X} $n]
                } else {
                    append out $ch
                }
            }
        }
    }
    append out "\""
    return $out
}

proc ::hdb_ai::chat_error {message {status {400 Bad Request}}} {
    wapp-reply-code $status
    wapp-mimetype {application/json; charset=utf-8}
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    wapp-unsafe [format {{"error":%s}} [::hdb_ai::json_quote $message]]
}

proc wapp-page-ai-chat {} {
    if {[wapp-param REQUEST_METHOD] ne "POST" || ![wapp-param SAME_ORIGIN 0]} {
        ::hdb_ai::chat_error "Only same-origin POST requests are allowed." {403 Forbidden}
        return
    }
    if {![string match -nocase "application/json*" [wapp-param CONTENT_TYPE ""]]} {
        ::hdb_ai::chat_error "Expected JSON request."
        return
    }
    set request [wapp-param CONTENT ""]
    if {[string length $request] > 16000} {
        ::hdb_ai::chat_error "Chat request too long." {413 Content Too Large}
        return
    }
    if {[catch {package require json; set input [::json::json2dict $request]}] ||
        [catch {dict get $input api_key} apiKey] ||
        [catch {dict get $input prompt} prompt]} {
        ::hdb_ai::chat_error "Invalid chat request."
        return
    }
    # Accept user-created API keys only; never use an application fallback.
    if {![regexp {^[A-Za-z0-9_-]{16,256}$} $apiKey] ||
        ![string is print -strict $apiKey]} {
        ::hdb_ai::chat_error "Enter a valid OpenAI API key."
        return
    }
    if {[string length $prompt] < 1 || [string length $prompt] > 12000} {
        ::hdb_ai::chat_error "Prompt is empty or too long."
        return
    }
    if {[catch {package require http; package require tls}]} {
        ::hdb_ai::chat_error "TLS support is not installed on this HammerDB instance." {503 Service Unavailable}
        return
    }
    # A missing/invalid CA chain fails closed; no plaintext or insecure fallback.
    ::http::register https 443 [list ::tls::socket -require 1 -servername api.openai.com]
    set instructions {You are HammerDB's benchmark analysis assistant. Reply concisely and accurately using ONLY the measured benchmark evidence the user supplies. Separate observation from hypothesis. Never invent metrics, results, wait events, costs or completed jobs. The run queue and GitHub submissions are controlled by HammerDB and the user, not by your response. Never direct the user to run raw shell commands or disclose secrets. Recommend sharing reviewed real results to TPC-OSS, but never claim they were uploaded. ASH is optional and sampled waits are not proof of causation.}
    set payload [format {{"model":"gpt-4.1-mini","instructions":%s,"input":%s,"max_output_tokens":650,"store":false}} \
        [::hdb_ai::json_quote $instructions] [::hdb_ai::json_quote $prompt]]
    set headers [list Authorization "Bearer $apiKey" Content-Type application/json Accept application/json]
    if {[catch {
        set tok [::http::geturl https://api.openai.com/v1/responses \
            -method POST -headers $headers -query $payload -timeout 30000]
    }]} {
        ::hdb_ai::chat_error "Unable to reach the model over verified TLS." {502 Bad Gateway}
        return
    }
    set code [::http::ncode $tok]
    set response [::http::data $tok]
    ::http::cleanup $tok
    if {$code != 200} {
        ::hdb_ai::chat_error "OpenAI refused this request (HTTP $code). Check the key and model access." {502 Bad Gateway}
        return
    }
    if {[string length $response] > 500000 ||
        [catch {set obj [::json::json2dict $response]}]} {
        ::hdb_ai::chat_error "Invalid response from model." {502 Bad Gateway}
        return
    }
    set answer ""
    if {![catch {set blocks [dict get $obj output]}]} {
        foreach block $blocks {
            if {[catch {dict get $block type} kind] || $kind ne "message"} continue
            if {[catch {dict get $block content} segments]} continue
            foreach segment $segments {
                if {[catch {dict get $segment type} type] || $type ne "output_text"} continue
                if {![catch {dict get $segment text} t]} {append answer $t "\n"}
            }
        }
    }
    set answer [string trim $answer]
    if {$answer eq ""} {
        ::hdb_ai::chat_error "The model did not provide text. Please retry." {502 Bad Gateway}
        return
    }
    wapp-mimetype {application/json; charset=utf-8}
    wapp-reply-extra Cache-Control {no-store}
    wapp-reply-extra X-Content-Type-Options nosniff
    wapp-reply-extra Referrer-Policy no-referrer
    wapp-unsafe [format {{"reply":%s}} [::hdb_ai::json_quote [string range $answer 0 5000]]]
}
