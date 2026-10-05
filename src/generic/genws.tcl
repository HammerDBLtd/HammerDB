proc putscli { output } {
#Suppress output in the Web Service
#Uncomment to debug
#    puts $output
#    TclReadLine::print "\r"
}


# Pipelines needs the CI configuration in the Web Service. Since v6.1 ci.db
# contains overrides only, load ci.xml as the base and merge v2 overrides.
proc ws_ci_read_overrides {} {
    set sqlitedb [CheckSQLiteDB "ci"]

    if {$sqlitedb eq "" || ![file exists $sqlitedb]} {
        return ""
    }

    catch {ciws close}
    if {[catch {sqlite3 ciws $sqlitedb}]} {
        return ""
    }
    catch {ciws timeout 30000}

    if {[catch {
        set version [ciws eval {SELECT val FROM "_ci_meta" WHERE key='schema_version' LIMIT 1}]
    }] || [string trim $version] ne "2"} {
        catch {ciws close}
        return ""
    }

    set overrides [dict create]
    if {[catch {
        set tbllist [ciws eval {SELECT name FROM sqlite_master WHERE type='table'}]
    }]} {
        catch {ciws close}
        return ""
    }

    foreach tbl $tbllist {
        if {$tbl eq "_ci_meta"} {
            continue
        }

        if {$tbl eq "common"} {
            set subdict [dict create]
            if {[catch {
                ciws eval "SELECT key, val FROM \"$tbl\"" {
                    dict set subdict $key $val
                }
            }]} {
                continue
            }
            dict set overrides common $subdict
            continue
        }

        if {![regexp {^([^_]+)_(.+)$} $tbl -> top section]} {
            continue
        }

        set secdict [dict create]
        if {[catch {
            ciws eval "SELECT key, val FROM \"$tbl\"" {
                dict set secdict $key $val
            }
        }]} {
            continue
        }
        dict set overrides $top $section $secdict
    }

    catch {ciws close}

    if {[dict size $overrides] == 0} {
        return ""
    }
    return $overrides
}

proc ws_ci_init_config {} {
    global cidict dirname

    set cidict [dict create]
    set ciplanxml [file join $dirname ci.xml]
    if {![file exists $ciplanxml]} {
        return
    }

    if {[catch {
        set cidict [::XML::To_Dict_Ml $ciplanxml]
    }]} {
        set cidict [dict create]
        return
    }

    set override_cfg [ws_ci_read_overrides]
    if {$override_cfg eq ""} {
        return
    }

    foreach top [dict keys $override_cfg] {
        if {$top eq "common"} {
            foreach key [dict keys [dict get $override_cfg common]] {
                dict set cidict common $key [dict get $override_cfg common $key]
            }
        } else {
            foreach section [dict keys [dict get $override_cfg $top]] {
                foreach key [dict keys [dict get $override_cfg $top $section]] {
                    dict set cidict $top $section $key [dict get $override_cfg $top $section $key]
                }
            }
        }
    }
}

ws_ci_init_config

proc is-dict {value} {
    #appx dictionary check
    return [expr {[string is list $value] && ([llength $value]&1) == 0}]
}
####WAPP PAGES##################################
proc wapp-2-json {dfields dict2json} {
    if {[string is integer -strict $dfields]} {
        if { $dfields <= 2 && $dfields >= 1 } {
            if {[ is-dict $dict2json ]} {
                ;
            } else {
                set dfields 2
                dict set dict2json error message "output procedure wapp-2-json called with invalid dictionary"
            }
        } else {
            set dfields 2
            dict set dict2json error message "output procedure wapp-2-json called with invalid number of fields"
        }
    }
    #escape backslashes in output to prevent JSON parse errors
    set dict2json [ regsub -all {\\} $dict2json {\\\\} ]
    if { $dfields == 2 } {
        set huddleobj [ huddle compile {dict * dict} $dict2json ]
    } else {
        set huddleobj [ huddle compile {dict} $dict2json ]
    }
    wapp-mimetype application/json
    wapp-trim { %unsafe([huddle jsondump $huddleobj]) }
}

proc wapp-default {} {
wapp-page-jobs
}

proc strip_html { htmlText } {
    regsub -all {<[^>]+>} $htmlText "" newText
    return $newText
}

proc env {} {
    global ws_port
    if [ catch {set tok [http::geturl http://localhost:$ws_port/env]} message ] {
        putscli $message
    } else {
        putscli [ strip_html [ http::data $tok ] ]
    }
    if { [ info exists tok ] } { http::cleanup $tok }
}

proc wapp-page-env {} {
    wapp-allow-xorigin-params
    global wapp
    set original [wapp-debug-env]
    hdb_info_header "Service environment"
    wapp-unsafe {<p>Diagnostics for this web-service request and its runtime.</p>}
    foreach category {Service Request Other} {
        wapp-subst {<details class="hdb-info-card" open><summary>%html($category)</summary><table class="hdb-kv"><tbody>}
        foreach key [lsort [dict keys $wapp]] {
            if {[string index $key 0] eq "."} continue
            set group Other
            if {[regexp {^(SERVER_|WAPP_)} $key]} {set group Service}
            if {[regexp {^(HTTP_|REQUEST_|REMOTE_|QUERY_|PATH_|CONTENT_|SCRIPT_|BASE_URL|SAME_ORIGIN)} $key]} {set group Request}
            if {$group eq $category} {hdb_kv_row $key [dict get $wapp $key]}
        }
        if {$category eq "Service"} {hdb_kv_row "Working directory" [pwd]}
        wapp-unsafe {</tbody></table></details>}
    }
    hdb_original_text $original
    hdb_info_footer
}


proc wapp-page-style.css {} {
    wapp-mimetype text/css
    wapp-allow-xorigin-params
    wapp-subst {
  body {
  margin: 0;
  padding: 0;
  padding-left: 20px;
  padding-top: 20px;
  background-color: #f9f9f9;
  font-family: 'Roboto', sans-serif;
  font-size: 14px;
  color: #333;
  line-height: 1.6;
}

td.status {
  text-align: center;
  vertical-align: middle;
}
td.status img {
  display: block;
  margin: 0 auto;
}

h1, h2, h3 {
  margin: 0 0 0.1em 0;
  font-family: 'Roboto', sans-serif;
  font-weight: 500;
  color: #222;
}

h1 {
  font-size: 2.5em;
}

h2 {
  font-size: 2em;
}

h3 {
  font-size: 1.5em;
}

p, ul, ol {
  margin: 0 0 1em 0;
}

ul, ol {
  padding-left: 1.5em;
  column-count: 1 !important;
  column-width: auto !important;
}

table {
  font-family: 'Roboto', sans-serif;
  font-size: 14px;
  color: #333;
  border-collapse: collapse;
  width: 100%;
  max-width: 980px;
  margin: 1em 0;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);
}

td, th {
  border: 1px solid #ccc;
  text-align: left;
  padding: 10px;
}

th {
  background-color: #f0f0f0;
  font-weight: 600;
}

tr:nth-child(even) {
  background-color: #f9f9f9;
}

@media print {
  .no-print {
    display: none !important;
  }

  .print-page-break {
    break-before: page;
    page-break-before: always;
  }

  .print-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
.aut-wrap {
  max-width: 980px;
}
.aut-wrap table {
  max-width: 100%;
  margin: 1em 0;
}

/* Shared CI/job page layout.  Keep widths tied together so tables and buttons align. */
.hdb-page {
  max-width: 1180px;
  margin: 0 16px 40px 16px;
}

.hdb-section {
  max-width: 980px;
  margin: 0 0 24px 0;
}

.hdb-table-wrap {
  width: 100%;
  max-width: 980px;
  overflow-x: auto;
  margin: 0 0 14px 0;
}

.hdb-table-wrap table,
table.hdb-table {
  width: 100%;
  max-width: none !important;
  min-width: 760px;
  margin: 1em 0;
}

.hdb-form {
  width: 100%;
  max-width: 980px;
  margin: 0 0 18px 0;
}

.hdb-form-narrow {
  width: 100%;
  max-width: 980px;
  margin: 0 0 18px 0;
}

.hdb-actions {
  width: 100%;
  max-width: 980px;
  text-align: right;
  margin: 8px 0 18px 0;
}

.hdb-actions-left {
  width: 100%;
  max-width: 980px;
  text-align: left;
  margin: 14px 0 22px 0;
}


.hdb-date-group {
  width: 100%;
  max-width: 980px;
  margin: 0 0 12px 0;
  box-sizing: border-box;
}

.hdb-date-group > summary {
  cursor: pointer;
  padding: 8px 10px;
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-weight: 600;
}

.hdb-date-group > summary span {
  font-weight: 400;
  opacity: 0.72;
  margin-left: 6px;
}

.hdb-date-group[open] > summary {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.hdb-date-group .hdb-table-wrap {
  margin-top: 0;
}

.hdb-date-group .hdb-table {
  margin-top: 0;
}

.hdb-activity {
  width: 100%;
  max-width: 980px;
  margin: 18px 0 20px 0;
  border-radius: 6px;
  background: #eef6ff;
  border: 1px solid #d0d7de;
  box-sizing: border-box;
}

.hdb-log-box {
  margin: 0;
  padding: 12px;
  height: 320px;
  overflow: auto;
  background: #eef6ff;
  color: #0a3d62;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.35;
  white-space: pre-wrap;
  box-sizing: border-box;
}

.hdb-jump-inline {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-left: 4px;
  font-size: 0.82em;
  opacity: 0.82;
}

.hdb-jump-inline a {
  text-decoration: none;
  white-space: nowrap;
}

.hdb-jump-inline a:hover {
  text-decoration: underline;
}

@media (max-width: 760px) {
  .hdb-page {
    margin: 0 8px 32px 8px;
  }
  .hdb-table-wrap table,
  table.hdb-table {
    min-width: 680px;
  }
  .hdb-actions,
  .hdb-actions-left {
    text-align: left;
  }
  .hdb-jump-inline {
    width: 100%;
    margin-left: 0;
    margin-top: 4px;
    line-height: 1.7;
  }
}

.aut-banner {
  width: 100%;
  box-sizing: border-box;
}
}
}

# ----------------------------
# CI WAPP page (HTML-only field display, stable + wrap + correct dict pretty)
# ----------------------------

# Fallback if is-dict not available
if {[info commands is-dict] eq ""} {
    proc is-dict {d} { expr {![catch {dict size $d}]} }
}

proc normalize_pre_text {s} {
    # CRLF/CR -> LF
    regsub -all {\r\n} $s "\n" s
    regsub -all {\r}   $s "\n" s

    # Expand literal escapes if present
    if {![string match "*\n*" $s] && [string match "*\\n*" $s]} {
        regsub -all {\\n} $s "\n" s
        regsub -all {\\t} $s "\t" s
    }

    return $s
}

proc split_cmake_records {s} {
    # 0) If there's no obvious CMake status marker, don't touch it
    #    (prevents wrecking non-cmake output)
    if {![string match "*-- *" $s]} {
        return $s
    }

    # 1) Fix glued percentage tokens: "done[ 2%]" -> "done\n[ 2%]"
    regsub -all {([^\n])(\[[ \t]*[0-9]+%])} $s "\\1\n\\2" s

    # 2) Fix glued cmake status lines:
    #    "...GNU 13.3.0-- The CXX ..." -> "...GNU 13.3.0\n-- The CXX ..."
    #    Only split on "-- " (cmake style), not every "--".
    regsub -all {([^\n])--[ \t]+} $s "\\1\n-- " s

    # 3) Clean up accidental leading newline
    if {[string match "\n-- *" $s]} {
        set s [string range $s 1 end]
    }

    return $s
}

# Heuristic: a "real" nested dict must have dict-size AND "sane" keys.
# Prevents command-lists like {git log -1 --pretty=%B} being mis-read as dicts.
proc is_real_nested_dict {x} {
    if {[catch {dict size $x}]} { return 0 }
    foreach k [dict keys $x] {
        # accept typical dict keys: letters/underscore then letters/digits/underscore
        if {![regexp {^[A-Za-z_][A-Za-z0-9_]*$} $k]} { return 0 }
    }
    return 1
}

# Quote a scalar value so "anything with spaces" stays together as { ... } on one line.
proc tcl_quote_value {v} {
    # If value contains whitespace or Tcl-special separators, brace it.
    if {[regexp {\s|[{};"\[\]]} $v]} {
        # Avoid double-bracing if it's already a single braced group representation
        return "{${v}}"
    }
    return $v
}

# Pretty print Tcl dicts in Tcl-dict style (preserves "key {value with spaces}" on one line,
# and nests dicts as "key { ... }").
proc pretty_tcl_dict {d {indent 0}} {
    if {![is_real_nested_dict $d]} {
        return $d
    }

    set pad [string repeat "  " $indent]
    set out ""

    dict for {k v} $d {
        if {[is_real_nested_dict $v]} {
            append out "${pad}$k {\n"
            append out [pretty_tcl_dict $v [expr {$indent+1}]]
            append out "${pad}}\n"
        } else {
            append out "${pad}$k [tcl_quote_value $v]\n"
        }
    }
    return $out
}

proc getcirow_id {ci_id} {
    set ci [dict create]
    if {[catch {
        hdbjobs eval {SELECT
            ci_id, refname, pipeline,
            io_intensive, profile_id,
            clone_cmd, clone_output,
            build_cmd, build_output,
            install_cmd, install_output,
            package_cmd, commit_msg,
            config_file, start_cmd,
            status, timestamp, end_timestamp,
            cidict
        FROM JOBCI
        WHERE ci_id=$ci_id} r {
            foreach k [array names r] { dict set ci $k $r($k) }
            break
        }
    } err]} {
        return [list error "Error querying JOBCI: $err"]
    }
    if {[dict size $ci] == 0} {
        return [list error "CI run not found for ci_id $ci_id"]
    }
    return $ci
}

proc getcirow {refname} {
    set ci [dict create]
    if {[catch {
        hdbjobs eval {SELECT
            ci_id, refname, pipeline, io_intensive, 
            profile_id, clone_cmd, clone_output,
            build_cmd, build_output,
            install_cmd, install_output,
            package_cmd, commit_msg,
            config_file, start_cmd,
            status, timestamp, end_timestamp,
            cidict
        FROM JOBCI
        WHERE refname=$refname
        ORDER BY ci_id DESC
        LIMIT 1} r {
            foreach k [array names r] { dict set ci $k $r($k) }
            break
        }
    } err]} {
        return [list error "Error querying JOBCI: $err"]
    }
    if {[dict size $ci] == 0} {
        return [list error "CI refname not found: $refname"]
    }
    return $ci
}

proc wapp-page-ci {} {
    wapp-allow-xorigin-params
    set B [wapp-param BASE_URL]

    # parse query
    set query [wapp-param QUERY_STRING]
    set params [split $query &]
    set paramdict [dict create]
    foreach a $params {
        if {$a eq ""} continue
        lassign [split $a =] k v
        dict set paramdict $k $v
    }
    # need ci_id or refname
    if {![dict exists $paramdict ci_id] && ![dict exists $paramdict refname]} {
        hdb_state_page "Choose a pipeline" "Open a Pipeline ID from the Pipelines page."
        return
    }

    # resolve CI row
    if {[dict exists $paramdict ci_id]} {
        set ci_id [dict get $paramdict ci_id]
        set ci [getcirow_id $ci_id]
    } else {
        set refname [dict get $paramdict refname]
        set ci [getcirow $refname]
        if {[is-dict $ci] && [dict exists $ci ci_id]} { set ci_id [dict get $ci ci_id] }
    }

    if {![is-dict $ci] || ![dict exists $ci refname] || ![dict exists $ci ci_id]} {
        hdb_state_page "Pipeline not found" "No saved pipeline matches this request."
        return
    }

    set refname [dict get $ci refname]

    if {[dict exists $paramdict index]} {
        hdb_info_header "Pipeline: $ci_id"
    } else {
    # HTML header
    wapp-content-security-policy { default-src 'self'; style-src 'self' 'unsafe-inline' *; img-src * data:; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; }
    wapp-subst {<link href="%url(/style.css)" rel="stylesheet"><link href="%url([wapp-param BASE_URL]/hdb-theme.css)" rel="stylesheet"><script src="%url([wapp-param BASE_URL]/hdb-theme.js)"></script>}
    wapp-subst {<p><img src='%html($B)/logo.png' width='55' height='60'></p>}
    wapp-subst {<h3 class="title">Pipeline: %html($ci_id)</h3>}

    }
    # if no index -> overview page
    if {![dict exists $paramdict index]} {

        # Human-readable labels for CI fields
        set field_labels [dict create \
            summary        "Summary" \
            status         "Status" \
            timestamp      "Start time" \
            end_timestamp  "End time" \
            commit_msg     "Commit message" \
            clone_cmd      "Clone command" \
            clone_output   "Clone output" \
            build_cmd      "Build command" \
            build_output   "Build output" \
            install_cmd    "Install command" \
            install_output "Install output" \
            package_cmd    "Package command" \
            config_file    "Config file" \
            start_cmd      "Start command" \
            cidict         "CI dictionary" \
        ]

        set fields {
            summary
            status
            timestamp
            end_timestamp
            commit_msg
            clone_cmd
            clone_output
            build_cmd
            build_output
            install_cmd
            install_output
            package_cmd
            config_file
            start_cmd
            cidict
        }

        # Pipeline detail sections v1
        wapp-subst {<main data-hdb-pipeline-detail="true" data-base="%html($B)">}
        foreach f $fields {
            set label [dict get $field_labels $f]
            set val ""
            if {$f eq "summary"} {
                foreach k {ci_id refname pipeline io_intensive profile_id status timestamp end_timestamp} {
                    set v ""
                    if {[dict exists $ci $k]} {set v [dict get $ci $k]}
                    append val "$k: $v\n"
                }
            } elseif {[dict exists $ci $f]} {
                set val [dict get $ci $f]
            }
            if {$f eq "start_cmd"} {set val [string map [list {\\\"} {"} {\"} {"}] $val]}
            if {$f in {clone_output build_output install_output}} {set val [normalize_pre_text $val]}
            if {$f eq "build_output"} {set val [split_cmake_records $val]}
            if {$f eq "cidict" && $val ne ""} {set val [pretty_tcl_dict $val]}
            set long [expr {$f in {clone_output build_output install_output cidict config_file} || [string length $val] > 600 || [llength [split $val \n]] > 8}]
            if {$long} {
                wapp-subst {<details class="hdb-ci-section" id="ci-%html($f)" data-ci-section="%html($label)"><summary>%html($label)</summary>}
            } else {
                wapp-subst {<section class="hdb-ci-section" id="ci-%html($f)" data-ci-section="%html($label)"><h2>%html($label)</h2>}
            }
            set max 2000000
            if {[string length $val] > $max} {
                set fullurl "$B/ci?ci_id=$ci_id&index=$f"
                wapp-subst {<p>Showing the first %html($max) characters. <a href="%html($fullurl)">Open section separately</a></p>}
                set val [string range $val 0 [expr {$max-1}]]
            }
            if {$val eq ""} {set val "(empty)"}
            wapp-subst {<pre>%html($val)</pre>}
            if {$long} {wapp-subst {</details>}} else {wapp-subst {</section>}}
        }

        wapp-subst {<section class="hdb-ci-section" id="ci-related" data-ci-section="Related jobs and profile"><h2>Related jobs and profile</h2>}
        # Performance profile
        set pid ""
        if {[dict exists $ci profile_id]} {
            set pid [string trim [dict get $ci profile_id]]
        }
        if {$pid ne "" && $pid != 0} {
            set purl "$B/jobs?profileid=$pid"
            wapp-subst {<p style="margin:12px 0 0 0;"><b>Performance Profile</b></p>\n}
            wapp-subst {<p style="margin:0;"><a href='%html($purl)'>Profile %html($pid)</a></p>\n}
        }

        # Jobs between CI start/end
        set start_ts [dict get $ci timestamp]
        set end_ts   [dict get $ci end_timestamp]
        if {$end_ts eq ""} { set end_ts $start_ts }

        wapp-subst {<p style="margin:14px 0 0 0;"><b>Jobs between CI start/end</b></p>\n}
        wapp-subst {<p style="margin:0 0 8px 0;">%html($start_ts) → %html($end_ts)</p>\n}

        wapp-subst {<ol style="margin:0; padding-left:1.5em;">\n}
        hdbjobs eval {
            SELECT jobid
            FROM JOBMAIN
            WHERE timestamp >= $start_ts
              AND timestamp <= $end_ts
            ORDER BY timestamp ASC
        } {
            set jurl "$B/jobs?jobid=$jobid&index=output"
            wapp-subst {<li style="margin:0; padding:0;"><a href='%html($jurl)'>%html($jobid)</a></li>\n}
        }
        wapp-subst {</ol>\n}

        wapp-subst {</section><p class="hdb-ci-backlinks"><a href="%html($B)/jobs">Jobs</a> | <a href="%html($B)/pipelines">Pipelines</a></p></main>}
        return
    }

    # ----------------------------
    # Field display page
    # ----------------------------
    set field [dict get $paramdict index]

    set allowed {
        summary status timestamp end_timestamp commit_msg
        clone_cmd clone_output
        build_cmd build_output
        install_cmd install_output
        package_cmd config_file
        start_cmd cidict
    }

    if {[lsearch -exact $allowed $field] < 0} {
        hdb_empty_card "Section not found" "This pipeline section is not recognised. Return to the pipeline overview."
        hdb_info_footer
    return
    }

    set back "$B/ci?ci_id=$ci_id"

    wapp-subst {<h4>%html([string totitle [string map {_ { }} $field]])</h4>\n}

    # summary is short
    if {$field eq "summary"} {
        wapp-subst {<pre style="white-space:pre-wrap; overflow-wrap:anywhere;">}
        foreach k {ci_id refname pipeline io_intensive profile_id status timestamp end_timestamp} {
            if {[dict exists $ci $k]} {
                set v [dict get $ci $k]
            } else {
                set v ""
            }
            if {(($k eq "end_timestamp") || ($k eq "profile_id")) && $v eq ""} {
                if {$k eq "profile_id"} {
                    set v "0"
                    wapp-subst "%html($k): %html($v)\n"
                } else {
                    wapp-subst "%html($k):\n"
                }
            } else {
                wapp-subst "%html($k): %html($v)\n"
            }
        }
        wapp-subst {</pre>}
        hdb_info_footer
    return
    }

    if {[dict exists $ci $field]} {
        set val [dict get $ci $field]
    } else {
        set val ""
    }

    if {$field eq "start_cmd"} { set val [string map [list {\\\"} {"} {\"} {"}] $val] }

    if {$val eq ""} {
        hdb_empty_card "No information recorded" "There is no saved content for this pipeline section."
        hdb_info_footer
    return
    }

    # Normalise line endings first
    if {$field in {clone_output build_output install_output}} {
        set val [normalize_pre_text $val]
    }

    # Only build_output: split glued CMake records
    if {$field eq "build_output"} {
        set val [split_cmake_records $val]
    }

    # Pretty print cidict (3+ level dict) in Tcl-dict style
    if {$field eq "cidict"} {
        set val [pretty_tcl_dict $val]
    }

    # truncate long outputs
    set max 2000000
    if {[string length $val] > $max} {
        wapp-subst {<p><i>Showing first %html($max) bytes of %html([string length $val]).</i></p>\n}
        set val [string range $val 0 [expr {$max-1}]]
    }

    # IMPORTANT: wrap long lines in <pre>
    wapp-subst {<pre style="white-space:pre-wrap; overflow-wrap:anywhere;">%html($val)</pre>}
    hdb_info_footer
    return
}

proc get_ws_port {} {
 upvar #0 genericdict genericdict
    if {[dict exists $genericdict webservice ws_port ]} {
        set ws_port [ dict get $genericdict webservice ws_port ]
        if { ![string is integer -strict $ws_port ] } {
            putscli "Warning port not set to integer in config setting to default"
            set ws_port 8080
        }
    } else {
        putscli "Warning port not found in config setting to default"
        set ws_port 8080
    }
return $ws_port
}

proc quit {} {
    global ws_port
    if { ![info exists ws_port ] } {
        set ws_port [ get_ws_port ]
	}
    if [ catch {set tok [http::geturl http://localhost:$ws_port/quit]} message ] {
        putscli $message
    } else {
        putscli [ strip_html [ http::data $tok ] ]
    }
    if { [ info exists tok ] } { http::cleanup $tok }
}

proc wapp-page-quit {} {
    exit
}

rename jobs {}
interp alias {} jobs {} jobs_ws

proc start_webservice { args } {
    global ws_port
    upvar #0 genericdict genericdict
    if {[dict exists $genericdict webservice ws_port ]} {
        set ws_port [ dict get $genericdict webservice ws_port ]
        if { ![string is integer -strict $ws_port ] } {
		if {$args != "gui" } {
            putscli "Warning port not set to integer in config setting to default"
    		}
            set ws_port 8080  
        }
    } else { 
		if {$args != "gui" } {
        putscli "Warning port not found in config setting to default"
		}
        set ws_port 8080  
    }
	init_job_tables_ws
		if {$args != "gui" } {
        putscli "Starting HammerDB Web Service on port $ws_port"
		}
switch $args {
"gui" {
        if [catch {wapp-start [ list --server $ws_port ]} message ] { }
}
"scgi" {
        if [catch {wapp-start [ list --scgi $ws_port ]} message ] { }
}
"wait" {
        if [catch {wapp-start [ list --server $ws_port ]} message ] {
            putscli "Error starting HammerDB webservice on port $ws_port in wait mode : $message"
        }
}
"nowait" {
        if [catch {wapp-start [ list --server $ws_port --nowait ]} message ] {
            putscli "Error starting HammerDB webservice on port $ws_port in nowait mode : $message"
}
}
}}

# HammerDB supporting pages v1
proc hdb_info_header {title} {
    set B [wapp-param BASE_URL]
    wapp-mimetype {text/html; charset=utf-8}
    wapp-subst {<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%html($title) - HammerDB</title><link rel="stylesheet" href="%url($B/hdb-theme.css)"><script src="%url($B/hdb-theme.js)"></script></head><body><main class="hdb-support-page" data-hdb-support="true" data-base="%html($B)"><header class="hdb-service-header"><h1>%html($title)</h1></header>}
}
proc hdb_info_footer {} {wapp-unsafe {</main></body></html>}}
proc hdb_empty_card {title message} {
    wapp-subst {<section class="hdb-state-card" role="status"><h2>%html($title)</h2><p>%html($message)</p></section>}
}
proc hdb_state_page {title message} {
    set B [wapp-param BASE_URL]
    hdb_info_header "Error"
    hdb_empty_card $title $message
    wapp-subst {<p><a class="hdb-action-link" href="%url($B/jobs)">Jobs</a> <a class="hdb-action-link" href="%url($B/pipelines)">Pipelines</a></p>}
    hdb_info_footer
}
proc hdb_original_text {value {label "View original plain text"}} {
    wapp-subst {<details class="hdb-plain-view"><summary>%html($label)</summary><pre>%html($value)</pre></details>}
}
proc hdb_kv_row {key value} {
    wapp-subst {<tr data-hdb-setting><th scope="row">%html($key)</th><td>}
    if {$value eq ""} {
        wapp-unsafe {<span class="hdb-muted">Not recorded</span>}
    } elseif {[regexp -nocase {password|passwd|secret|token|authorization|cookie} $key]} {
        wapp-subst {<details><summary>Reveal value</summary><span>%html($value)</span></details>}
    } else {wapp-subst {%html($value)}}
    wapp-unsafe {</td></tr>}
}
proc hdb_config_view {config original} {
    wapp-subst {<div class="hdb-config-view"><label class="hdb-search-label">Find a setting <input type="search" data-hdb-config-search placeholder="Search names or values"></label>}
    if {[catch {dict size $config}] || $config eq ""} {
        hdb_empty_card "Structured configuration unavailable" "Use the original plain-text view below."
    } else {
        dict for {group value} $config {
            wapp-subst {<details class="hdb-info-card" data-hdb-config-group open><summary>%html($group)</summary><table class="hdb-kv"><tbody>}
            if {[is_real_nested_dict $value] && $value ne ""} {
                dict for {key val} $value {hdb_kv_row $key $val}
            } else {hdb_kv_row $group $value}
            wapp-unsafe {</tbody></table></details>}
        }
    }
    wapp-unsafe {<p data-hdb-no-settings hidden>No matching settings.</p>}
    hdb_original_text $original
    wapp-unsafe {</div>}
}
proc hdb_system_view {system original} {
    if {[dict exists $system message]} {
        hdb_empty_card "System information not recorded" "No system information was saved for this job."
    } else {
        wapp-unsafe {<div class="hdb-system-grid">}
        foreach {group keys} {Compute {hostname cpumodel cpucount memory system_vendor system_type} Software {os_name other_software} Storage {storage} Network {nic} Other {jobid cloud_instance extra}} {
            wapp-subst {<section class="hdb-info-card"><h2>%html($group)</h2><table class="hdb-kv"><tbody>}
            foreach key $keys {
                set value ""
                if {[dict exists $system $key]} {set value [dict get $system $key]}
                hdb_kv_row [string map {_ { }} $key] $value
            }
            wapp-unsafe {</tbody></table></section>}
        }
        wapp-unsafe {</div>}
    }
    hdb_original_text $original
}
proc hdb_output_status {jobid} {
    set status [join [hdbjobs eval {SELECT OUTPUT FROM JOBOUTPUT WHERE JOBID=$jobid AND VU=0}]]
    wapp-unsafe {<div data-hdb-output-view></div>}
    wapp-subst {<details class="hdb-info-card" open><summary>Recorded status</summary><pre>%html($status)</pre></details>}
    hdb_original_text $status "View original status plain text"
}
proc wapp-page-ui-preview {} {
    wapp-allow-xorigin-params
    set state [wapp-param state empty]
    if {$state eq "error"} {
        hdb_state_page "Preview: item unavailable" "This is a display preview. No job or pipeline has been modified."
    } else {
        hdb_state_page "Preview: no records yet" "Records will appear here once a run has saved data. This preview does not clear your database."
    }
}

proc wapp-page-hdb-theme.css {} {
    wapp-mimetype text/css
    wapp-unsafe {
/* HammerDB web theme: first local development iteration. */
:root { color-scheme:dark; --bg:#121414; --panel:#1b1e1d; --raised:#242927; --text:#edf2ef; --muted:#a7b3ac; --border:#354039; --accent:#5ee0a0; --success-bg:#142e22; --error-bg:#361f22; --error:#ffb2b9; }
:root[data-theme="light"] { color-scheme:light; --bg:#f5f7f6; --panel:#ffffff; --raised:#edf2ef; --text:#18241d; --muted:#53665b; --border:#cdd8d1; --accent:#147747; --success-bg:#e7f5ed; --error-bg:#fff0f1; --error:#a52a39; }
html body { box-sizing:border-box; margin:0 auto; padding:28px 24px 48px; max-width:1240px; background:var(--bg); color:var(--text); font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
html *,html *::before,html *::after { box-sizing:border-box; }
html h1,html h2,html h3,html h4 { color:var(--text); font-family:inherit; letter-spacing:-.025em; }
html h3 { font-size:24px; font-weight:600; }
html a { color:var(--accent); text-underline-offset:3px; }
html a:hover { text-decoration:underline; }
html :focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
html table { color:var(--text); font-family:inherit; box-shadow:none; background:var(--panel); }
html td,html th { border-color:var(--border); padding:12px 14px; }
html th { background:var(--raised); color:var(--muted); font-size:12px; letter-spacing:.035em; }
html tr:nth-child(even) { background:var(--panel); }
html tr:hover td { background:var(--raised); }
html .hdb-page { max-width:980px; }
html .hdb-section,html .hdb-table-wrap,html .hdb-form,html .hdb-form-narrow,html .aut-wrap { width:100%; max-width:980px; min-width:0; }
html .hdb-page { width:calc(100% - 32px); }
html .aut-banner { width:100%; max-width:980px; padding:16px; overflow-wrap:anywhere; border-radius:8px; }
html .aut-ok { color:var(--accent); background:var(--success-bg); border-color:var(--border); }
html .aut-fail { color:var(--error); background:var(--error-bg); border-color:var(--error); }
html pre { max-width:100%; overflow:auto; }
html .aut-details pre { white-space:pre-wrap; overflow-wrap:anywhere; }
html .hdb-date-group > summary { background:var(--raised); border-color:var(--border); padding:12px 14px; }
html .hdb-activity,html .hdb-log-box { background:var(--panel); color:var(--text); border-color:var(--border); }
html button,html input,html select,html textarea { font:inherit; color:var(--text); background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:8px 12px; }
html input[type="checkbox"],html input[type="radio"] { accent-color:var(--accent); }
html button,html input[type="submit"] { cursor:pointer; }
html button:hover,html input[type="submit"]:hover { background:var(--raised); border-color:var(--accent); }
html .hdb-theme-toolbar { display:flex; justify-content:flex-end; margin:0 16px 12px; }
html .hdb-theme-toggle { min-width:112px; font-size:13px; }
html .aut-mini { color:var(--muted); opacity:1; }

/* Shared brand mark: identical spacing and natural aspect ratio. */
html .hdb-brand-logo { margin:12px 16px 6px; }
html .hdb-brand-logo img { display:block; width:55px; height:auto; }
/* Keep the blue brand mark readable without recolouring the artwork. */
html[data-theme="dark"] .hdb-brand-logo img { background:#fff; padding:6px; border-radius:6px; box-sizing:content-box; }
html .hdb-brand-logo img { padding:6px; border-radius:6px; box-sizing:content-box; }

@media(max-width:760px) { html body { padding:16px 8px 32px; } html .hdb-page { width:calc(100% - 16px); } html h3 { font-size:20px; } }
@media print { :root { color-scheme:light; --bg:white; --panel:white; --raised:#eee; --text:black; --muted:#333; --border:#ccc; --accent:#145c37; } .hdb-theme-toolbar { display:none!important; } }
/* HammerDB website brand alignment v1 */
:root, :root[data-theme="dark"] {
  --bg:#0b1220; --panel:#111a2b; --text:#e6eefc; --muted:#9fb0c8;
  --brand:#ff7900; --brand-700:#e96f00; --link:#5da9ff;
  --ring:rgba(93,169,255,.35); --card:#0f1726; --border:#1e2a44;
  --raised:#111a2b; --accent:var(--link); --success-bg:#102a25;
  --success:#83d9ad; --error-bg:#321d29; --error:#ffb2b9;
}
:root[data-theme="light"] {
  --bg:#f7f9fc; --panel:#ffffff; --text:#0e1626; --muted:#536176;
  --brand:#ff7900; --brand-700:#e96f00; --link:#185adb;
  --ring:rgba(24,90,219,.2); --card:#ffffff; --border:#e6eaf2;
  --raised:#edf2f8; --accent:var(--link); --success-bg:#e7f5ed;
  --success:#17643d; --error-bg:#fff0f1; --error:#a52a39;
}
html body {
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";
  line-height:1.6;
}
html h1,html h2,html h3,html h4 { font-family:inherit; letter-spacing:normal; font-weight:600; }
html table { font-family:inherit; background:var(--card); }
html a { color:var(--link); text-decoration:none; }
html a:hover { text-decoration:underline; }
html :focus-visible { outline:2px solid var(--link); outline-offset:3px; box-shadow:0 0 0 .2rem var(--ring); }
html button,html input,html select,html textarea { border-radius:.6rem; }
html button,html input[type="submit"],html input[type="button"] {
  background:var(--brand); color:#0e1626; border:1px solid transparent;
  border-radius:.7rem; padding:.6rem .9rem; font-weight:700;
}
html button:hover,html input[type="submit"]:hover,html input[type="button"]:hover { background:var(--brand-700); border-color:transparent; }
html button:disabled,html input:disabled { opacity:.55; cursor:not-allowed; }
html .hdb-theme-toolbar select { background:var(--panel); color:var(--text); font-weight:600; }
html .hdb-date-group > summary { border-radius:.7rem; }
html .hdb-date-group[open] > summary { border-bottom-left-radius:0; border-bottom-right-radius:0; }
html .aut-banner { border-radius:.75rem; }
html .aut-ok { color:var(--success); }
html .hdb-service-header { border-bottom-color:var(--border)!important; }
html .hdb-service-nav { flex-wrap:wrap; }
html .hdb-service-nav > a { color:var(--text); border-color:var(--border)!important; border-radius:.6rem!important; font-weight:600!important; }
html .hdb-service-nav > a:hover { background:var(--panel); text-decoration:none; }
/* Same 44px brand mark height used by the public website. */
html .hdb-brand-logo img { width:auto; height:44px; max-width:100%; object-fit:contain; }
@media print {
  :root,:root[data-theme] { --bg:white; --panel:white; --card:white; --text:black; --muted:#333; --raised:#eee; --border:#ccc; --link:#185adb; }
}
/* End HammerDB website brand alignment v1 */

/* HammerDB sidebar workspace v1 */
html body.hdb-workspace-layout { max-width:none; margin:0; padding:24px 32px 48px 264px; }
html .hdb-sidebar { position:fixed; inset:0 auto 0 0; width:232px; padding:24px 16px; overflow-y:auto; background:var(--card); border-right:1px solid var(--border); z-index:30; }
html .hdb-sidebar-brand { display:flex; align-items:center; gap:12px; color:var(--text); font-size:19px; font-weight:700; margin-bottom:32px; }
html .hdb-sidebar-brand:hover { text-decoration:none; }
html .hdb-sidebar .hdb-brand-logo { margin:0; }
html .hdb-sidebar nav { display:flex; flex-direction:column; gap:4px; }
html .hdb-sidebar nav a { display:block; padding:10px 12px; border-radius:8px; color:var(--muted); font-weight:500; }
html .hdb-sidebar nav a:hover { background:var(--panel); color:var(--text); text-decoration:none; }
html .hdb-sidebar nav a[aria-current="page"] { background:var(--panel); color:var(--text); box-shadow:inset 3px 0 var(--brand); font-weight:700; }
html .hdb-sidebar-caption { margin:24px 12px 4px; color:var(--muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.09em; }
html .hdb-workspace-layout .hdb-service-header { margin:0 0 24px!important; padding-bottom:20px!important; }
html .hdb-workspace-layout .hdb-theme-toolbar { margin:0 0 16px; align-items:center; gap:12px; }
html .hdb-workspace-layout .hdb-page { width:100%; max-width:none; margin:0; }
html .hdb-workspace-layout .hdb-section,
html .hdb-workspace-layout .hdb-table-wrap,
html .hdb-workspace-layout .hdb-date-group,
html .hdb-workspace-layout .hdb-activity,
html .hdb-workspace-layout .aut-banner { width:100%; max-width:none!important; }
html .hdb-workspace-layout table { max-width:none; }
html .hdb-workspace-layout .hdb-table-wrap { border-radius:8px; }
html .hdb-workspace-layout .hdb-table-wrap table { margin:0; }
html .hdb-workspace-layout .hdb-date-group { margin-bottom:16px; }
html .hdb-workspace-layout [hidden] { display:none!important; }
html .hdb-sidebar-toggle { display:none; }
html .hdb-skip { position:fixed; top:8px; left:250px; transform:translateY(-160%); z-index:50; padding:8px 16px; background:var(--panel); }
html .hdb-skip:focus { transform:none; }
@media(max-width:900px) {
  html body.hdb-workspace-layout { padding:16px; }
  html .hdb-sidebar { display:none; top:76px; box-shadow:8px 8px 24px rgba(0,0,0,.25); }
  html .hdb-nav-open .hdb-sidebar { display:block; }
  html .hdb-sidebar-toggle { display:inline-flex; margin-right:auto; }
  html .hdb-skip { left:16px; }
}
@media print { html .hdb-sidebar,html .hdb-sidebar-toggle,html .hdb-skip { display:none!important; } html body.hdb-workspace-layout { padding:0; } }

/* HammerDB individual job workspace v4 */
html .hdb-job-workspace { width:100%; min-width:0; }
html .hdb-job-layout .hdb-service-header { display:block; }
html .hdb-job-layout .hdb-service-header .title { margin:0; overflow-wrap:anywhere; font-size:22px; }
html .hdb-job-section-title { font-size:18px; margin:0 0 16px; }
html .hdb-job-frame { display:block; width:100%; height:calc(100vh - 200px); min-height:420px; border:1px solid var(--border); border-radius:10px; background:var(--bg); }
html .hdb-job-loading { color:var(--muted); }
html .hdb-sidebar nav a.hdb-job-delete { color:var(--text); }
html .hdb-sidebar nav hr { width:100%; margin:16px 0 8px; border:0; border-top:1px solid var(--border); }
html .hdb-job-layout [hidden] { display:none!important; }

html .hdb-job-metadata { display:flex; flex-wrap:wrap; gap:16px 36px; margin:18px 0; }
html .hdb-job-metadata div { min-width:130px; }
html .hdb-job-metadata dt { color:var(--muted); font-size:13px; }
html .hdb-job-metadata dd { margin:4px 0 0; color:var(--text); font-weight:600; overflow-wrap:anywhere; }
html .hdb-delete-button { background:#b42318; color:#fff; border:1px solid #b42318; padding:10px 16px; border-radius:8px; font-weight:600; cursor:pointer; }
html .hdb-delete-button:hover { background:#912018; color:#fff; }
html .hdb-delete-dialog { width:min(480px,calc(100vw - 40px)); padding:24px; border:1px solid var(--border); border-radius:12px; background:var(--panel); color:var(--text); }
html .hdb-delete-dialog::backdrop { background:rgba(0,0,0,.65); }
html .hdb-delete-dialog h2 { margin-top:0; }
html .hdb-dialog-actions { display:flex; justify-content:flex-end; gap:12px; margin-top:24px; }
html .hdb-delete-dialog button:disabled { opacity:.6; cursor:wait; }
html .hdb-nopm-value { color:#12343b!important; background:#e7f4f6!important; }

/* Profile workspace and chart presentation */
html .hdb-job-meta-row { display:flex; align-items:center; flex-wrap:wrap; gap:16px 32px; }
html .hdb-job-meta-row .hdb-job-metadata { margin:18px 0; }
html .hdb-delete-button { background:var(--brand); color:#17120b; border-color:var(--brand); }
html .hdb-delete-button:hover { background:var(--brand-700,#e96f00); color:#17120b; }
html #workload-log-panel > summary { color:var(--text)!important; background:var(--panel); border-left-color:var(--brand)!important; border-radius:8px; }
html .hdb-profile-workspace { width:100%; min-width:0; }
html .hdb-profile-workspace .hdb-service-header h1 { font-size:24px; font-weight:600; margin:0; overflow-wrap:anywhere; }
html .hdb-profile-workspace > div { max-width:none!important; margin:16px 0!important; }
html .hdb-modern-chart { width:100%!important; max-width:100%; min-width:0; margin:16px 0!important; background:var(--panel)!important; border:1px solid var(--border); border-radius:12px; }
html .hdb-profile-workspace .hdb-modern-chart { height:480px!important; }
html .hdb-profile-workspace > a { display:inline-flex; padding:8px 12px; border:1px solid var(--border); border-radius:8px; margin:16px 0; }
html [data-hdb-compare-error] { color:var(--text)!important; background:var(--panel); border:1px solid var(--border); padding:16px; border-radius:8px; }
@media(max-width:600px) { html .hdb-profile-workspace .hdb-modern-chart { height:380px!important; } }

/* Pipeline detail and final alignment refinements */
html .hdb-job-meta-row > .hdb-delete-button { margin-left:auto; flex-shrink:0; }
html [data-hdb-pipeline-detail] { width:100%; min-width:0; }
html .hdb-ci-section { border:1px solid var(--border); background:var(--panel); border-radius:10px; margin:0 0 16px; padding:18px 20px; scroll-margin-top:20px; }
html .hdb-ci-section h2,html .hdb-ci-section summary { font-size:16px; font-weight:600; margin:0; color:var(--text); }
html .hdb-ci-section summary { cursor:pointer; }
html .hdb-ci-section pre { background:transparent!important; border:0; color:var(--text); white-space:pre-wrap; overflow-wrap:anywhere; max-height:600px; overflow:auto; margin:14px 0 0; padding:0; }
html .hdb-pipeline-detail-layout .hdb-service-header .title { margin:0; font-size:24px; }
html .hdb-pipeline-detail-layout .hdb-ci-backlinks { display:none; }
html .hdb-sidebar nav a[aria-current="location"] { background:var(--panel); color:var(--text); box-shadow:inset 3px 0 var(--brand); }
@media(max-width:600px){html .hdb-job-meta-row > .hdb-delete-button{margin-left:0;} html .hdb-ci-section{padding:14px;}}

/* HammerDB supporting page styles v1 */
html .hdb-support-page {width:100%;min-width:0;}
html .hdb-support-page h1 {font-size:26px;margin:0;}
html .hdb-info-card,html .hdb-plain-view,html .hdb-log-panel,html .hdb-state-card {background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin:0 0 18px;}
html .hdb-info-card h2,html .hdb-state-card h2 {font-size:18px;margin:0 0 12px;}
html .hdb-info-card summary,html .hdb-plain-view summary,html .hdb-log-panel summary {font-weight:600;cursor:pointer;}
html .hdb-system-grid,html .hdb-help-grid {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:18px;}
html .hdb-kv {width:100%;border-collapse:collapse;table-layout:fixed;margin:12px 0 0;}
html .hdb-kv th,html .hdb-kv td {padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid var(--border);}
html .hdb-kv th {width:34%;color:var(--muted);font-weight:500;}
html .hdb-kv td {white-space:pre-wrap;}
html .hdb-plain-view pre,html .hdb-info-card pre,html .hdb-log-panel pre {white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:65vh;padding:14px 0 0;background:transparent;color:var(--text);border:0;}
html .hdb-search-label {display:block;margin-bottom:18px;}
html .hdb-search-label input {display:block;margin-top:8px;min-width:240px;}
html .hdb-log-toolbar {display:flex;flex-wrap:wrap;gap:10px;margin:0 0 18px;align-items:center;}
html .hdb-log-toolbar input {flex:1;min-width:220px;}
html .hdb-support-page > pre {background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:20px;white-space:pre-wrap;overflow-wrap:anywhere;}
html .hdb-muted,html .hdb-empty-cell {color:var(--muted);}
html .hdb-empty-cell {padding:24px!important;}
html .hdb-action-link {display:inline-block;padding:8px 12px;border:1px solid var(--border);border-radius:8px;}
html [hidden] {display:none!important;}

/* Consistent primary navigation v1 */
html .hdb-primary-navigation {display:flex;flex-direction:column;gap:4px;padding-bottom:12px;margin-bottom:4px;border-bottom:1px solid var(--border);}
html .hdb-primary-navigation a[aria-current="page"] {background:var(--panel);color:var(--text);box-shadow:inset 3px 0 var(--brand);font-weight:700;}

/* Pipeline activity contrast v1 */
html #ci-log-panel > summary {
  color:var(--text)!important;
  background:var(--panel);
  border-left-color:var(--brand)!important;
  border-radius:8px;
}

}
}


# Original output text v1
proc hdb_output_originals {rows} {
    set original ""
    foreach {vu output} $rows {append original "VU $vu\n$output\n\n"}
    if {$original eq ""} {set original "(empty)"}
    hdb_original_text $original "View original output plain text"
}

proc wapp-page-hdb-theme.js {} {
    wapp-mimetype {text/javascript; charset=utf-8}
    wapp-unsafe {
(() => {
  if (window.hdbThemeLoaded) return;
  window.hdbThemeLoaded = true;
  const key = 'hammerdb-theme-preference';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch (_) {}
  const apply = () => {
    document.documentElement.dataset.theme = preference === 'system'
      ? (system.matches ? 'dark' : 'light') : preference;
  };
  apply();
  system.addEventListener('change', apply);
  const mount = () => {
    const toolbar = document.createElement('div');
    toolbar.className = 'hdb-theme-toolbar';
    const label = document.createElement('label');
    label.textContent = 'Theme ';
    const select = document.createElement('select');
    select.className = 'hdb-theme-toggle';
    select.setAttribute('aria-label', 'Colour theme');
    for (const value of ['system', 'light', 'dark']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
      select.append(option);
    }
    select.value = preference;
    select.addEventListener('change', () => {
      preference = valid(select.value);
      try { localStorage.setItem(key, preference); } catch (_) {}
      apply();
    });
    label.append(select);
    toolbar.append(label);
    document.body.prepend(toolbar);
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) {
        preference = valid(event.newValue);
        select.value = preference;
        apply();
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
/* HammerDB sidebar workspace v1 */
(() => {
  const mount = () => {
    const header = document.querySelector('.hdb-service-header');
    const page = document.querySelector('.hdb-page');
    const logo = document.querySelector('.hdb-brand-logo');
    if (!header || !page || !logo || document.querySelector('.hdb-sidebar')) return;
    const nav = header.querySelector('.hdb-service-nav');
    const peer = nav && nav.querySelector('a');
    if (!peer) return;
    const peerURL = new URL(peer.href, location.href);
    if (!/\/(jobs|pipelines)$/.test(peerURL.pathname)) return;
    const base = peerURL.pathname.replace(/\/(jobs|pipelines)$/, '');
    const isPipelines = peerURL.pathname.endsWith('/jobs');
    const sidebar = document.createElement('aside');
    sidebar.className = 'hdb-sidebar';
    sidebar.id = 'hdb-sidebar';
    const brand = document.createElement('a');
    brand.className = 'hdb-sidebar-brand';
    brand.href = base + '/jobs';
    brand.append(logo);
    const name = document.createElement('span');
    name.textContent = 'HammerDB';
    brand.append(name);
    sidebar.append(brand);
    const navigation = document.createElement('nav');
    navigation.setAttribute('aria-label', 'Workspace navigation');
    const links = [
      ['Jobs', '/jobs', ''], ['Pipelines', '/pipelines', ''],
      ['TPROC-C', '/jobs', '#jobs-tprocc'], ['Profiles', '/jobs', '#jobs-profiles'],
      ['TPROC-H', '/jobs', '#jobs-tproch'], ['Activity', '/jobs', '#jobs-activity'],
      ['Environment', '/jobs', '#jobs-env']
    ];
    links.forEach(([label, path, hash], index) => {
      if (index === 2) {
        const caption = document.createElement('p');
        caption.className = 'hdb-sidebar-caption';
        caption.textContent = 'Job views'; navigation.append(caption);
      }
      const a = document.createElement('a');
      a.textContent = label; a.href = base + path + hash;
      if (!hash && ((isPipelines && path === '/pipelines') || (!isPipelines && path === '/jobs'))) a.setAttribute('aria-current', 'page');
      navigation.append(a);
    });
    sidebar.append(navigation);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'hdb-sidebar-toggle';
    button.textContent = 'Navigation'; button.setAttribute('aria-controls', sidebar.id);
    const narrow = matchMedia('(max-width: 900px)');
    const close = () => {
      document.body.classList.remove('hdb-nav-open');
      button.setAttribute('aria-expanded', 'false');
      sidebar.inert = narrow.matches;
    };
    button.addEventListener('click', () => {
      const open = !document.body.classList.contains('hdb-nav-open');
      document.body.classList.toggle('hdb-nav-open', open);
      button.setAttribute('aria-expanded', String(open));
      sidebar.inert = narrow.matches && !open;
    });
    sidebar.addEventListener('click', event => { if (event.target.closest('a')) close(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.body.classList.contains('hdb-nav-open')) { close(); button.focus(); }
    });
    narrow.addEventListener('change', close);
    document.body.prepend(sidebar);
    const toolbar = document.querySelector('.hdb-theme-toolbar');
    if (toolbar) toolbar.prepend(button); else header.prepend(button);
    // Keep cloud-injected actions in the header; remove only duplicated navigation.
    peer.hidden = true;
    const jumps = nav.querySelector('.hdb-jump-inline');
    if (jumps) jumps.hidden = true;
    page.id = 'hdb-workspace'; page.setAttribute('tabindex', '-1');
    const skip = document.createElement('a');
    skip.href = '#hdb-workspace'; skip.textContent = 'Skip to content'; skip.className = 'hdb-skip';
    document.body.prepend(skip);
    document.body.classList.add('hdb-workspace-layout');
    close();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();

/* HammerDB individual job workspace v4 */
(() => {
  const mount = () => {
    const menu = document.querySelector('[data-hdb-job-index]');
    if (!menu || window.frameElement || document.querySelector('.hdb-job-frame')) return;
    const links = [...menu.querySelectorAll('ol a')];
    const views = links.filter(a => !['delete', 'bm', 'db', 'timestamp', 'status'].some(k => new URL(a.href).searchParams.has(k)));
    if (!views.length) return;
    const job = new URL(views[0].href).searchParams.get('jobid');
    const jobsPath = new URL(views[0].href).pathname;
    const title = document.querySelector('h3.title');
    const logo = document.querySelector('body > p img');
    if (!title || !logo) return;
    const sidebar = document.createElement('aside');
    sidebar.id = 'hdb-sidebar'; sidebar.className = 'hdb-sidebar';
    const brand = document.createElement('a');
    brand.href = jobsPath; brand.className = 'hdb-sidebar-brand';
    const logoBox = logo.parentElement;
    logoBox.className = 'hdb-brand-logo';
    logo.removeAttribute('height'); logo.alt = 'HammerDB';
    const brandName = document.createElement('span'); brandName.textContent = 'HammerDB';
    brand.append(logoBox, brandName); sidebar.append(brand);
    const nav = document.createElement('nav'); nav.setAttribute('aria-label', 'Job sections');
    const back = document.createElement('a'); back.href = jobsPath; back.textContent = 'All jobs';
    nav.append(back);
    const caption = document.createElement('p'); caption.className = 'hdb-sidebar-caption';
    // Section links follow All jobs without a redundant caption.
    views.forEach(a => { if (new URL(a.href).searchParams.size === 1) a.textContent = 'Output & Status'; nav.append(a); });
    const deletion = links.find(a => new URL(a.href).searchParams.has('delete'));
    sidebar.append(nav);
    const main = document.createElement('main'); main.id = 'hdb-workspace';
    main.className = 'hdb-job-workspace'; main.tabIndex = -1;
    const heading = document.createElement('header'); heading.className = 'hdb-service-header';
    title.textContent = 'Job: ' + job; heading.append(title); main.append(heading);
    const metadata = document.querySelector('.hdb-job-metadata');
    const metadataRow = document.createElement('div'); metadataRow.className = 'hdb-job-meta-row'; heading.append(metadataRow);
    if (metadata) metadataRow.append(metadata);
    if (deletion) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'hdb-delete-button'; remove.textContent = 'Delete job';
      metadataRow.append(remove);
      const dialog = document.createElement('dialog'); dialog.className = 'hdb-delete-dialog';
      const dialogTitle = document.createElement('h2'); dialogTitle.id = 'hdb-delete-title'; dialogTitle.textContent = 'Delete this job?';
      dialog.setAttribute('aria-labelledby', dialogTitle.id);
      const explanation = document.createElement('p'); explanation.textContent = 'Permanently delete job ' + job + ' and its saved results? This cannot be undone.';
      const error = document.createElement('p'); error.setAttribute('role', 'alert');
      const actions = document.createElement('div'); actions.className = 'hdb-dialog-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.autofocus = true;
      const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Delete job'; confirm.className = 'hdb-delete-button';
      actions.append(cancel, confirm); dialog.append(dialogTitle, explanation, error, actions); document.body.append(dialog);
      let busy = false;
      remove.addEventListener('click', () => { error.textContent = ''; dialog.showModal(); cancel.focus(); });
      cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
      dialog.addEventListener('close', () => remove.focus());
      confirm.addEventListener('click', async () => {
        if (busy) return;
        busy = true; confirm.disabled = cancel.disabled = true; confirm.textContent = 'Deleting...';
        error.textContent = '';
        const url = new URL(deletion.href); url.searchParams.delete('delete'); url.searchParams.set('DELETE', '');
        try {
          const response = await fetch(url, {cache:'no-store', credentials:'same-origin'});
          const result = await response.json();
          if (!response.ok || !result.success || result.error) throw new Error(result.error?.message || 'The server did not confirm deletion.');
          location.assign(jobsPath);
        } catch (err) {
          error.textContent = 'Deletion was not confirmed: ' + err.message + ' Check the Jobs page before trying again.';
          busy = false; confirm.disabled = cancel.disabled = false; confirm.textContent = 'Delete job';
        }
      });
    }
    const sectionTitle = document.createElement('h2'); sectionTitle.className = 'hdb-job-section-title';
    const frame = document.createElement('iframe'); frame.className = 'hdb-job-frame';
    frame.name = 'hdb-job-content';
    const loading = document.createElement('p'); loading.className = 'hdb-job-loading';
    loading.setAttribute('role', 'status'); loading.textContent = 'Loading section…';
    main.append(sectionTitle, loading, frame);
    menu.replaceWith(main); document.body.prepend(sidebar);
    // The old footer is redundant inside this workspace.
    [...document.querySelectorAll('body > a, body > div > a')].forEach(a => {
      if (a.textContent.trim() === 'Job Index' && new URL(a.href).pathname === jobsPath) a.hidden = true;
    });
    document.body.classList.add('hdb-workspace-layout', 'hdb-job-layout');
    const toggle = document.createElement('button'); toggle.type = 'button';
    toggle.className = 'hdb-sidebar-toggle'; toggle.textContent = 'Navigation';
    toggle.setAttribute('aria-controls', sidebar.id);
    const narrow = matchMedia('(max-width: 900px)');
    const close = () => {
      document.body.classList.remove('hdb-nav-open'); toggle.setAttribute('aria-expanded', 'false');
      sidebar.inert = narrow.matches;
    };
    toggle.addEventListener('click', () => {
      const open = !document.body.classList.contains('hdb-nav-open');
      document.body.classList.toggle('hdb-nav-open', open);
      toggle.setAttribute('aria-expanded', String(open)); sidebar.inert = narrow.matches && !open;
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('hdb-nav-open')) { close(); toggle.focus(); }
    });
    narrow.addEventListener('change', close);
    (document.querySelector('.hdb-theme-toolbar') || heading).prepend(toggle); close();
    const skip = document.createElement('a'); skip.className = 'hdb-skip';
    skip.href = '#hdb-workspace'; skip.textContent = 'Skip to content'; document.body.prepend(skip);
    const key = a => [...new URL(a.href).searchParams.keys()].find(k => k !== 'jobid') || 'output';
    const all = views;
    const themeCharts = win => window.hdbPaintCharts && window.hdbPaintCharts(win);
    const syncTheme = () => {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) {
        doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
        themeCharts(frame.contentWindow);
      }
    };
    new MutationObserver(syncTheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
    frame.addEventListener('load', () => {
      loading.hidden = true; frame.removeAttribute('aria-busy');
      const doc = frame.contentDocument;
      if (!doc) { loading.textContent = 'This section could not be displayed.'; loading.hidden = false; return; }
      syncTheme();
      const sheet = document.querySelector('link[href*="hdb-theme.css"]');
      if (sheet && !doc.querySelector('link[href*="hdb-theme.css"]')) doc.head.append(sheet.cloneNode(true));
      const style = doc.createElement('style');
      style.textContent = 'html body{max-width:none!important;margin:0!important;padding:16px!important;} body>p:has(>img),body>h3.title,.hdb-theme-toolbar{display:none!important;}';
      doc.head.append(style);
      [...doc.querySelectorAll('a')].forEach(a => {
        const u = new URL(a.href);
        if (u.pathname !== jobsPath) return;
        if (a.textContent.trim() === 'Job Index') a.hidden = true;
        if (u.searchParams.has('index') && u.searchParams.get('jobid') === job) {
          a.hidden = true;
        }
      });
    });
    const select = a => {
      all.forEach(link => link.removeAttribute('aria-current'));
      a.setAttribute('aria-current', 'page'); sectionTitle.textContent = a.textContent;
      frame.title = a.textContent + ' for job ' + job;
      loading.textContent = 'Loading section…'; loading.hidden = false; frame.setAttribute('aria-busy', 'true');
      frame.src = a.href; close();
    };
    const fromHash = () => all.find(a => (location.hash === '#section=status' ? '#section=output' : location.hash) === '#section=' + key(a)) || views[0];
    all.forEach(a => {
      a.addEventListener('click', e => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); history.pushState(null, '', '#section=' + key(a)); select(a);
        sectionTitle.tabIndex = -1; sectionTitle.focus({preventScroll:true});
      });
    });
    window.addEventListener('popstate', () => select(fromHash()));
    select(fromHash());
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();

/* HammerDB profile workspace and chart styling v1 */
(() => {
  const palette = ['#ff7900', '#5da9ff', '#39c6b5', '#b69cff', '#f2c75c', '#ef8ea5'];
  window.hdbPaintCharts = win => {
    if (!win || !win.echarts) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const text = dark ? '#ffffff' : '#0e1626';
    const muted = dark ? '#c3d0e5' : '#536176';
    const border = dark ? '#29364c' : '#e6eaf2';
    const instances = new Map();
    win.document.querySelectorAll('[_echarts_instance_]').forEach(el => {
      const chart = win.echarts.getInstanceByDom(el);
      if (chart && chart.getDom() === el) instances.set(el, chart);
    });
    // Each embedded report chart can load a fresh ECharts registry.
    // Ticklecharts retains each instance in a chart_* global; use those too.
    Object.keys(win).filter(key => key.startsWith('chart_')).forEach(key => {
      const chart = win[key];
      if (chart && typeof chart.getDom === 'function' && typeof chart.getOption === 'function' && !chart.isDisposed()) {
        const el = chart.getDom(); if (el && el.isConnected) instances.set(el, chart);
      }
    });
    instances.forEach((chart, el) => {
      if (chart.isDisposed()) return;
      el.classList.add('hdb-modern-chart');
      const current = chart.getOption();
      const comparison = (current.series || []).some(s => /\b(Base|New)\b/i.test(s.name || ''));
      const options = {
        backgroundColor:'transparent', color:palette, animationDurationUpdate:250,
        textStyle:{color:text, fontFamily:'system-ui, -apple-system, Segoe UI, sans-serif'},
        series:(current.series || []).map((s, i) => {
          const name = s.name || '';
          const colour = /\bNOPM\b|GEOMEAN/i.test(name) ? palette[0] : /\bTPM\b|QUERY SET/i.test(name) ? palette[1] : palette[i % palette.length];
          const result = {itemStyle:{color:colour, opacity:1}, label:{color:text}};
          if (s.type === 'line') {
            result.lineStyle = {color:colour, width:2.5};
            result.symbolSize = 5;
            const rgb = [1,3,5].map(offset => parseInt(colour.slice(offset,offset+2),16)).join(',');
            result.areaStyle = {opacity:1, color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[
              {offset:0,color:'rgba('+rgb+','+(comparison ? '0.24' : '0.40')+')'},
              {offset:1,color:'rgba('+rgb+',0)'}
            ]}};
            // Retain Base solid / New dashed styles and the original data geometry.
            if (comparison) result.lineStyle.type = /\bNew\b/i.test(name) ? 'dashed' : 'solid';
          }
          if (s.type === 'bar') { // Wide benchmark result bars only; other charts use automatic series spacing.
            const resultChart = (current.title || []).some(title => /\bTPROC-[CH]\s+Result\b/i.test(title.text || ''));
            result.barMaxWidth = null;
            result.barWidth = resultChart ? '34%' : null;
            result.barGap = resultChart ? '10%' : '30%'; result.itemStyle.borderWidth = 0; result.itemStyle.borderRadius = [4,4,0,0]; }
          if (s.type === 'boxplot') { result.itemStyle.borderColor = colour; result.itemStyle.opacity = .8; }
          return result;
        })
      };
      for (const kind of ['xAxis','yAxis','radiusAxis','angleAxis']) {
        if (current[kind]) options[kind] = current[kind].map(() => ({axisLabel:{color:text},nameTextStyle:{color:text},axisLine:{lineStyle:{color:border}},splitLine:{lineStyle:{color:border,type:'dashed'}}}));
      }
      if (current.title) options.title = current.title.map(() => ({left:16,top:12,textStyle:{color:text,fontSize:16,fontWeight:600,width:Math.max(180,el.clientWidth-40),overflow:'break'},subtextStyle:{color:muted}}));
      if (current.legend) options.legend = current.legend.map(() => ({left:'center',bottom:8,type:'scroll',textStyle:{color:text},inactiveColor:muted,itemWidth:18,itemHeight:8}));
      if (current.grid && current.grid.length === 1) options.grid = [{left:24,right:24,top:88,bottom:64,containLabel:true}];
      if (current.tooltip) options.tooltip = current.tooltip.map(() => ({backgroundColor:dark?'#111a2b':'#fff',borderColor:border,textStyle:{color:text},extraCssText:'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);'}));
      chart.setOption(options);
      chart.resize();
    });
  };
  const message = (text, returnFocus, afterClose) => {
    const dialog = document.createElement('dialog'); dialog.className = 'hdb-delete-dialog';
    const title = document.createElement('h2'); title.id = 'hdb-compare-dialog-title'; title.textContent = 'Choose two different profiles';
    dialog.setAttribute('aria-labelledby',title.id);
    const body = document.createElement('p'); body.textContent = text;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Choose profiles';
    dialog.append(title,body,close); document.body.append(dialog);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {dialog.remove(); if (returnFocus) returnFocus.focus(); if (afterClose) afterClose();}, {once:true});
    dialog.showModal(); close.focus();
  };
  const mount = () => {
    document.querySelectorAll('form').forEach(form => {
      if (!form.querySelector('input[name="cmd"][value="profilediff"]')) return;
      form.addEventListener('submit', e => {
        const base = form.querySelector('input[name="base_pid"]:checked');
        const next = form.querySelector('input[name="new_pid"]:checked');
        if (!base || !next || Number(base.value) === Number(next.value)) {
          e.preventDefault();
          message(!base || !next ? 'Select one Base profile and one New profile before comparing.' : 'Base and New currently refer to the same profile. Select a different New profile to compare.', next || base || form.querySelector('input[type="radio"]'));
        }
      });
    });
    const query = new URLSearchParams(location.search);
    const profilePage = !query.has('jobid') && (query.has('profileid') || query.get('cmd') === 'profilediff');
    if (profilePage && !window.frameElement && !document.querySelector('.hdb-sidebar')) {
      const indexLink = [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Job Index');
      if (indexLink) {
        const jobs = new URL(indexLink.href).pathname;
        const base = jobs.replace(/\/jobs$/, '');
        const sidebar = document.createElement('aside'); sidebar.id = 'hdb-sidebar'; sidebar.className = 'hdb-sidebar';
        const brand = document.createElement('a'); brand.className = 'hdb-sidebar-brand'; brand.href = jobs;
        const logoBox = document.createElement('p'); logoBox.className = 'hdb-brand-logo';
        const oldLogo = [...document.images].find(img => new URL(img.src).pathname.endsWith('/logo.png'));
        const logo = oldLogo || document.createElement('img'); logo.src = base + '/logo.png'; logo.alt = 'HammerDB'; logo.removeAttribute('height');
        const oldParent = logo.parentElement; logoBox.append(logo);
        if (oldParent && oldParent.tagName === 'P' && !oldParent.textContent.trim()) oldParent.remove();
        const name = document.createElement('span'); name.textContent = 'HammerDB'; brand.append(logoBox,name); sidebar.append(brand);
        const nav = document.createElement('nav'); nav.setAttribute('aria-label','Workspace navigation');
        for (const [label,path] of [['Jobs',jobs],['Pipelines',base+'/pipelines'],['Performance profiles',jobs+'#jobs-profiles']]) {
          const a = document.createElement('a'); a.textContent = label; a.href = path;
          if (label === 'Performance profiles') a.setAttribute('aria-current','page'); nav.append(a);
        }
        sidebar.append(nav);
        const main = document.createElement('main'); main.id = 'hdb-workspace'; main.className = 'hdb-profile-workspace'; main.tabIndex = -1;
        const header = document.createElement('header'); header.className = 'hdb-service-header';
        const title = document.createElement('h1');
        title.textContent = query.has('profileid') ? 'Performance profile: '+query.get('profileid') : 'Performance profile comparison';
        header.append(title); main.append(header);
        indexLink.remove();
        [...document.body.childNodes].forEach(node => {
          if (node.nodeType === 1 && (node.matches('.hdb-theme-toolbar, script, style, link'))) return;
          main.append(node);
        });
        document.body.append(main); document.body.prepend(sidebar); document.body.classList.add('hdb-workspace-layout','hdb-profile-layout');
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'hdb-sidebar-toggle'; toggle.textContent = 'Navigation'; toggle.setAttribute('aria-controls',sidebar.id);
        const narrow = matchMedia('(max-width: 900px)');
        const close = () => {document.body.classList.remove('hdb-nav-open');toggle.setAttribute('aria-expanded','false');sidebar.inert=narrow.matches;};
        toggle.addEventListener('click',()=>{const open=!document.body.classList.contains('hdb-nav-open');document.body.classList.toggle('hdb-nav-open',open);toggle.setAttribute('aria-expanded',String(open));sidebar.inert=narrow.matches&&!open;});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('hdb-nav-open')){close();toggle.focus();}});
        narrow.addEventListener('change',close); close();
        (document.querySelector('.hdb-theme-toolbar')||header).prepend(toggle);
        const skip=document.createElement('a');skip.href='#hdb-workspace';skip.className='hdb-skip';skip.textContent='Skip to content';document.body.prepend(skip);
        const error = main.querySelector('[data-hdb-compare-error]');
        if (error) message(error.textContent,null,()=>location.assign(jobs+'#jobs-profiles'));
      }
    }
    const paint = () => window.hdbPaintCharts(window);
    paint();
    window.addEventListener('load',paint,{once:true});
    new MutationObserver(paint).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    let pending;
    window.addEventListener('resize',()=>{clearTimeout(pending);pending=setTimeout(paint,120);});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

/* HammerDB pipeline detail workspace v1 */
(() => {
  const mount = () => {
    const content = document.querySelector('[data-hdb-pipeline-detail]');
    if (!content || document.querySelector('.hdb-sidebar')) return;
    const base = content.dataset.base || '';
    const sidebar = document.createElement('aside'); sidebar.id='hdb-sidebar'; sidebar.className='hdb-sidebar';
    const brand=document.createElement('a');brand.href=base+'/jobs';brand.className='hdb-sidebar-brand';
    const logoBox=document.createElement('p');logoBox.className='hdb-brand-logo';
    const logo=[...document.images].find(img=>new URL(img.src).pathname.endsWith('/logo.png'));
    if(logo){const old=logo.parentElement;logo.removeAttribute('height');logo.alt='HammerDB';logoBox.append(logo);if(old.tagName==='P'&&!old.textContent.trim())old.remove();}
    const name=document.createElement('span');name.textContent='HammerDB';brand.append(logoBox,name);sidebar.append(brand);
    const nav=document.createElement('nav');nav.setAttribute('aria-label','Pipeline navigation');
    for(const [label,url] of [['Jobs',base+'/jobs'],['Pipelines',base+'/pipelines']]){
      const a=document.createElement('a');a.href=url;a.textContent=label;nav.append(a);
    }
    const sectionHeading=document.createElement('p');
    sectionHeading.className='hdb-sidebar-caption';
    sectionHeading.textContent='Pipeline sections';
    nav.append(sectionHeading);
    const links=[];
    content.querySelectorAll('[data-ci-section]').forEach(section=>{
      const a=document.createElement('a');a.href='#'+section.id;a.textContent=section.dataset.ciSection;nav.append(a);links.push(a);
    });
    sidebar.append(nav);document.body.prepend(sidebar);
    const title=document.querySelector('h3.title');
    const header=document.createElement('header');header.className='hdb-service-header';
    if(title)header.append(title);content.prepend(header);
    content.id='hdb-workspace';content.tabIndex=-1;
    document.body.classList.add('hdb-workspace-layout','hdb-pipeline-detail-layout');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='hdb-sidebar-toggle';toggle.textContent='Navigation';toggle.setAttribute('aria-controls',sidebar.id);
    const narrow=matchMedia('(max-width: 900px)');
    const close=()=>{document.body.classList.remove('hdb-nav-open');toggle.setAttribute('aria-expanded','false');sidebar.inert=narrow.matches;};
    toggle.addEventListener('click',()=>{const open=!document.body.classList.contains('hdb-nav-open');document.body.classList.toggle('hdb-nav-open',open);toggle.setAttribute('aria-expanded',String(open));sidebar.inert=narrow.matches&&!open;});
    narrow.addEventListener('change',close);close();
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('hdb-nav-open')){close();toggle.focus();}});
    (document.querySelector('.hdb-theme-toolbar')||header).prepend(toggle);
    const skip=document.createElement('a');skip.className='hdb-skip';skip.href='#hdb-workspace';skip.textContent='Skip to content';document.body.prepend(skip);
    const reveal=()=>{
      const section=[...content.querySelectorAll('[data-ci-section]')].find(s=>'#'+s.id===location.hash);
      links.forEach(a=>{a.removeAttribute('aria-current');if(a.hash===location.hash)a.setAttribute('aria-current','location');});
      if(section){if(section.tagName==='DETAILS')section.open=true;requestAnimationFrame(()=>section.scrollIntoView({block:'start'}));}
    };
    links.forEach(a=>a.addEventListener('click',()=>{close();if(a.hash===location.hash)reveal();}));
    window.addEventListener('hashchange',reveal);reveal();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
/* HammerDB supporting page interactions v1 */
(() => {
  const mount = () => {
    const page=document.querySelector('[data-hdb-support]');
    if(page&&!window.frameElement&&!document.querySelector('.hdb-sidebar')){
      const base=page.dataset.base||'';
      const sidebar=document.createElement('aside');sidebar.className='hdb-sidebar';sidebar.id='hdb-sidebar';
      const brand=document.createElement('a');brand.href=base+'/jobs';brand.className='hdb-sidebar-brand';
      const p=document.createElement('p');p.className='hdb-brand-logo';const img=document.createElement('img');img.src=base+'/logo.png';img.alt='HammerDB';p.append(img);
      const name=document.createElement('span');name.textContent='HammerDB';brand.append(p,name);sidebar.append(brand);
      const nav=document.createElement('nav');nav.setAttribute('aria-label','Workspace navigation');
      for(const [label,path] of [['Jobs','/jobs'],['Pipelines','/pipelines'],['Help','/help'],['Environment','/env']]){
        const a=document.createElement('a');a.href=base+path;a.textContent=label;if(location.pathname===base+path)a.setAttribute('aria-current','page');nav.append(a);
      }
      const params=new URLSearchParams(location.search);
      if(location.pathname.endsWith('/ci')&&params.has('ci_id')){
        const caption=document.createElement('p');caption.className='hdb-sidebar-caption';caption.textContent='This pipeline';nav.append(caption);
        const a=document.createElement('a');a.href=base+'/ci?ci_id='+encodeURIComponent(params.get('ci_id'));a.textContent='Pipeline overview';nav.append(a);
      }
      sidebar.append(nav);document.body.prepend(sidebar);document.body.classList.add('hdb-workspace-layout');
      page.id='hdb-workspace';page.tabIndex=-1;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='hdb-sidebar-toggle';toggle.textContent='Navigation';toggle.setAttribute('aria-controls',sidebar.id);
      const narrow=matchMedia('(max-width: 900px)');
      const close=()=>{document.body.classList.remove('hdb-nav-open');toggle.setAttribute('aria-expanded','false');sidebar.inert=narrow.matches;};
      toggle.addEventListener('click',()=>{const open=!document.body.classList.contains('hdb-nav-open');document.body.classList.toggle('hdb-nav-open',open);toggle.setAttribute('aria-expanded',String(open));sidebar.inert=narrow.matches&&!open;});
      document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('hdb-nav-open')){close();toggle.focus();}});
      narrow.addEventListener('change',close);close();(document.querySelector('.hdb-theme-toolbar')||page).prepend(toggle);
      const skip=document.createElement('a');skip.className='hdb-skip';skip.href='#hdb-workspace';skip.textContent='Skip to content';document.body.prepend(skip);
    }
    document.querySelectorAll('[data-hdb-config-search]').forEach(input=>{
      input.addEventListener('input',()=>{
        const term=input.value.toLowerCase();const view=input.closest('.hdb-config-view');let total=0;
        view.querySelectorAll('[data-hdb-config-group]').forEach(group=>{
          let found=0;group.querySelectorAll('[data-hdb-setting]').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(term);if(!row.hidden)found++;});group.hidden=!found;if(term&&found)group.open=true;total+=found;
        });view.querySelector('[data-hdb-no-settings]').hidden=total>0;
      });
    });
    const output=document.querySelector('[data-hdb-output-view]');
    if(output){
      const panels=[];
      document.querySelectorAll('h5').forEach(heading=>{
        if(!/^VU\s+\d+/.test(heading.textContent))return;
        const pre=heading.nextElementSibling;if(!pre||pre.tagName!=='PRE')return;
        const details=document.createElement('details');details.className='hdb-log-panel';details.open=panels.length===0;
        const summary=document.createElement('summary');summary.textContent=heading.textContent+' · '+pre.textContent.split('\n').length+' lines';
        heading.replaceWith(details);details.append(summary,pre);panels.push(details);
      });
      const toolbar=document.createElement('div');toolbar.className='hdb-log-toolbar';
      const search=document.createElement('input');search.type='search';search.placeholder='Find text in virtual-user output';search.setAttribute('aria-label','Search output');toolbar.append(search);
      const feedback=document.createElement('span');feedback.setAttribute('role','status');
      const text=()=>panels.map(p=>p.querySelector('summary').textContent+'\n'+p.querySelector('pre').textContent).join('\n\n');
      const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);toolbar.append(b);return b;};
      button('Copy output',async()=>{try{await navigator.clipboard.writeText(text());feedback.textContent='Copied';}catch{feedback.textContent='Copy unavailable; use Download output.';}});
      button('Download output',()=>{const url=URL.createObjectURL(new Blob([text()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='hammerdb-job-output.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      const wrap=button('Disable line wrap',()=>{const noWrap=output.classList.toggle('hdb-no-wrap');panels.forEach(p=>p.querySelector('pre').style.whiteSpace=noWrap?'pre':'pre-wrap');wrap.textContent=noWrap?'Enable line wrap':'Disable line wrap';});
      search.addEventListener('input',()=>{const term=search.value.toLowerCase();let count=0;panels.forEach(p=>{p.hidden=!p.querySelector('pre').textContent.toLowerCase().includes(term);if(!p.hidden){count++;if(term)p.open=true;}});feedback.textContent=count+' virtual-user sections match';});
      toolbar.append(feedback);output.append(toolbar);
    }
    // Existing empty table rows retain their content and gain a quieter panel style.
    document.querySelectorAll('td[colspan]').forEach(cell=>{if(/^No .*found|^No .*available/.test(cell.textContent.trim()))cell.classList.add('hdb-empty-cell');});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

/* Shared Help and pipeline feature navigation v1 */
(() => {
  const mount = () => {
    const nav=document.querySelector('.hdb-sidebar nav');
    const brand=document.querySelector('.hdb-sidebar-brand');
    if(!nav||!brand)return;
    const base=new URL(brand.href).pathname.replace(/\/jobs$/,'');
    let help=[...nav.querySelectorAll('a')].find(a=>new URL(a.href).pathname===base+'/help');
    if(!help){
      help=document.createElement('a');help.href=base+'/help';help.textContent='Help';
      const pipelines=[...nav.querySelectorAll('a')].find(a=>new URL(a.href).pathname===base+'/pipelines');
      const first=nav.querySelector('a');
      if(pipelines)pipelines.after(help);else if(first)first.after(help);else nav.prepend(help);
    }
    if(location.pathname===base+'/help')help.setAttribute('aria-current','page');
    const query=new URLSearchParams(location.search);
    if(location.pathname===base+'/ci'&&(query.has('ci_id')||query.has('refname'))){
      const caption=document.createElement('p');caption.className='hdb-sidebar-caption';caption.textContent='Pipeline features';
      const link=document.createElement('a');link.textContent='Open build output';
      const url=new URL(base+'/ci',location.origin);
      for(const key of ['ci_id','refname'])if(query.has(key))url.searchParams.set(key,query.get(key));
      url.searchParams.set('index','build_output');link.href=url.href;
      if(query.get('index')==='build_output')link.setAttribute('aria-current','page');
      nav.append(caption,link);
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

/* Consistent primary navigation v1 */
(() => {
  const mount = () => {
    const nav=document.querySelector('.hdb-sidebar nav');
    const brand=document.querySelector('.hdb-sidebar-brand');
    if(!nav||!brand)return;
    const base=new URL(brand.href).pathname.replace(/\/jobs$/,'');
    const route=location.pathname.slice(base.length).replace(/\/$/,'')||'/jobs';
    const query=new URLSearchParams(location.search);
    // Replace earlier page-specific variants with one shared primary group.
    [...nav.querySelectorAll('a')].forEach(a=>{
      const url=new URL(a.href);
      const path=url.pathname.slice(base.length);
      if((['/jobs','/pipelines','/help','/env'].includes(path)&&!url.search&&!url.hash)||
         (path==='/jobs'&&url.hash==='#jobs-env'))a.remove();
    });
    const primary=document.createElement('div');primary.className='hdb-primary-navigation';
    const items=[['Jobs','/jobs'],['Pipelines','/pipelines'],['Help','/help']];
    if(route==='/env')items.push(['Environment','/env']);
    const active=route==='/ci'?'/pipelines':route;
    items.forEach(([label,path])=>{
      const a=document.createElement('a');a.href=base+path;a.textContent=label;
      if(path===active)a.setAttribute('aria-current','page');
      primary.append(a);
    });
    nav.prepend(primary);
    // A job's remaining links are local sections, just like pipeline sections.
    if(document.body.classList.contains('hdb-job-layout')){
      const caption=document.createElement('p');caption.className='hdb-sidebar-caption';caption.textContent='Job sections';primary.after(caption);
    }
    let title;
    if(route==='/jobs'){
      title=query.has('jobid')?'Job: '+query.get('jobid'):query.has('profileid')?'Performance profile: '+query.get('profileid'):query.get('cmd')==='profilediff'?'Performance profile comparison':'Jobs';
    }else if(route==='/pipelines')title='Pipelines';
    else if(route==='/help')title='Help';
    else if(route==='/env')title='Environment';
    else if(route==='/ci')title=query.has('ci_id')?'Pipeline: '+query.get('ci_id'):'Pipeline details';
    const heading=document.querySelector('.hdb-support-page h1');
    if(heading&&heading.textContent==='Error')title='Error';
    if(title)document.title=title+' - HammerDB';
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();

}
}
