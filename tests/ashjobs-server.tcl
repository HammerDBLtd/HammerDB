# Local-only Wapp/SQLite browser fixture. Samples are synthetic; every activity
# query and saved chart point comes from the existing desktop ASH cursors.
# Usage: TCLLIBPATH=<native SQLite path> tclsh tests/ashjobs-server.tcl ?port? ?db?
set root [file dirname [file dirname [file normalize [info script]]]]
::tcl::tm::path add [file join $root modules]
package require sqlite3
package require wapp
package require jobs
package require ashstore
package require ashreplay

set fixture_port [expr {[llength $argv] ? [lindex $argv 0] : 8097}]
set fixture_path [expr {[llength $argv] > 1 ? [lindex $argv 1] : ":memory:"}]
set genericdict [dict create commandline [dict create sqlite_db $fixture_path jobs_disable 0]]
set bm TPC-C
set hdb_version 6.2
sqlite3 ::hdbjobs $fixture_path
set fixture_db ::hdbjobs
hdbjobs eval {
    CREATE TABLE IF NOT EXISTS JOBMAIN(jobid TEXT PRIMARY KEY,db TEXT,bm TEXT,jobdict TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,profile_id INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS JOBOUTPUT(jobid TEXT,vu INTEGER,output TEXT);
    CREATE TABLE IF NOT EXISTS JOBTIMING(jobid TEXT,vu INTEGER,procname TEXT,calls INTEGER,min_ms REAL,
        avg_ms REAL,max_ms REAL,total_ms REAL,p99_ms REAL,p95_ms REAL,p75_ms REAL,p50_ms REAL,
        p25_ms REAL,sd REAL,ratio_pct REAL,summary INTEGER,elapsed_ms REAL);
    CREATE TABLE IF NOT EXISTS JOBTCOUNT(jobid TEXT,counter INTEGER,metric TEXT,timestamp TEXT);
    CREATE TABLE IF NOT EXISTS JOBMETRIC(jobid TEXT,usr REAL,sys REAL,irq REAL,idle REAL,
        iops REAL,mbps REAL,timestamp TEXT);
    CREATE TABLE IF NOT EXISTS JOBSYSTEM(jobid TEXT,hostname TEXT,cpumodel TEXT,cpucount INTEGER);
}
::ashstore::init $fixture_db
set fixture_base [clock scan {2026-11-05 12:00:00} -timezone UTC]
set fixture_sql {SELECT '<img src=x onerror="window.__ashXSS=1"><script>window.__ashXSS=2</script>' AS unsafe_text; -- & " '}

# Use the real common service assets without starting the full CLI/web shell.
proc fixture_load_proc {filename name} {
    set channel [open $filename];set source [read $channel];close $channel
    set body "";set found 0
    foreach line [split $source \n] {
        if {!$found && [string match "proc $name *" [string trimleft $line]]} {set found 1}
        if {$found} {
            append body $line \n
            if {[info complete $body]} {uplevel #0 $body;return}
        }
    }
    error "Missing service asset procedure $name"
}
foreach name {wapp-page-style.css wapp-page-hdb-theme.css wapp-page-hdb-theme.js hdb_output_status hdb_empty_card hdb_output_originals} {
    fixture_load_proc [file join $root src generic genws.tcl] $name
}
proc putscli {message} {}

proc fixture_metadata {{last 30}} {
    return [dict create server_timezone UTC server_now [expr {$::fixture_base+$last}] \
        run_start $::fixture_base bucket_secs 15 source_collation deterministic driver_cpucount 8]
}
proc fixture_sample {offset pid id type event text} {
    set epoch [expr {$::fixture_base+$offset}]
    return [dict create ash_time [clock format $epoch -timezone UTC -format {%Y-%m-%d %H:%M:%S}] \
        _epoch $epoch pid $pid queryid $id query $text cmdtype SELECT \
        usename bench application_name HammerDB backend_type {client backend} \
        wait_event_type $type wait_event $event xact_start [expr {$epoch-1}]]
}
proc fixture_samples {{extra 0}} {
    set rows {}
    foreach {offset pid id type event} {
        1 11 q1 CPU CPU 4 11 q1 IO DataFileRead 7 11 q1 CPU CPU
        10 22 q2 Lock transactionid 13 22 q2 Lock transactionid
        16 33 q3 CPU CPU 19 33 q3 CPU CPU 22 33 q3 IO DataFileRead
        25 33 q3 CPU CPU 28 33 q3 CPU CPU
    } {
        set text [expr {$id eq "q3" ? $::fixture_sql : "SELECT '$id'"}]
        lappend rows [fixture_sample $offset $pid $id $type $event $text]
    }
    if {$extra} {
        foreach offset {31 34 37 40 43} {
            lappend rows [fixture_sample $offset 44 q4 IO DataFileRead {SELECT 'later transfer'}]
        }
    }
    return $rows
}
proc fixture_stats {} {
    set rows {}
    foreach id {q1 q2 q3 q4} {
        foreach offset {0 30 45} {
            set epoch [expr {$::fixture_base+$offset}]
            set row [dict create ash_time $epoch _epoch $epoch queryid $id calls [expr {1+$offset}] \
                total_exec_time [expr {2.5*$offset}] rows [expr {$offset+1}]]
            foreach key {shared_blks_hit shared_blks_read shared_blks_dirtied shared_blks_written \
                local_blks_hit local_blks_read local_blks_dirtied local_blks_written temp_blks_read \
                temp_blks_written blk_read_time blk_write_time plans total_plan_time wal_records wal_fpi wal_bytes} {
                dict set row $key 0
            }
            lappend rows $row
        }
    }
    return $rows
}
proc fixture_chart {samples {last 30}} {
    set points {}
    foreach refresh {15 30 45} {
        if {$refresh > $last} break
        set metadata [fixture_metadata $refresh]
        set options [dict create begin $::fixture_base end [expr {$::fixture_base+$refresh}]]
        foreach point [::ashreplay::query pg ash $samples {} $metadata $options] {
            dict set point _epoch [expr {$::fixture_base+$refresh}]
            lappend points $point
        }
    }
    return $points
}
proc fixture_initialize {} {
    set db $::fixture_db
    $db eval {DELETE FROM JOBASH;DELETE FROM JOBASHINFO;DELETE FROM JOBMAIN}
    foreach id {ASH-HISTORY ASH-LIVE ASH-EMPTY ASH-NONE} {
        $db eval {INSERT INTO JOBMAIN(jobid,db,bm,jobdict) VALUES($id,'PostgreSQL','TPC-C','fixture synthetic')}
    }
    set samples [fixture_samples]
    foreach id {ASH-HISTORY ASH-LIVE ASH-EMPTY} {
        ::ashstore::begin $db $id pg [fixture_metadata]
        if {$id eq "ASH-EMPTY"} continue
        ::ashstore::append $db $id samples $samples
        ::ashstore::append $db $id sqlstats [fixture_stats]
        ::ashstore::append $db $id chart [fixture_chart $samples]
        if {$id eq "ASH-HISTORY"} {::ashstore::finish $db $id complete}
    }
}
fixture_initialize

proc wapp-default {} {wapp-reply-code {404 Not Found};wapp-unsafe {Fixture route not found}}
proc wapp-page-test-control {} {
    wapp-mimetype application/json
    wapp-reply-extra Cache-Control no-store
    set action [wapp-param action]
    switch -- $action {
        reset {fixture_initialize}
        transfer {
            set samples [fixture_samples 1]
            ::ashstore::append $::fixture_db ASH-LIVE samples $samples
            ::ashstore::append $::fixture_db ASH-LIVE chart [fixture_chart $samples 45]
            ::ashstore::update_metadata $::fixture_db ASH-LIVE [fixture_metadata 45]
        }
        complete {::ashstore::finish $::fixture_db ASH-LIVE complete}
        default {error "Unknown fixture mutation"}
    }
    wapp-unsafe {{"ok":true}}
}

# Independent query oracle: bypasses Jobs' report assembly and evaluates the
# authoritative desktop cursors against the fixture's persisted native rows.
proc wapp-page-test-oracle {} {
    set id [wapp-param jobid]
    set metadata [::ashstore::metadata $::fixture_db $id]
    set options [dict create begin [wapp-param begin] end [wapp-param end]]
    foreach {parameter key} {sqlid sql_id eventid event_id sessionid session_id} {
        if {[wapp-param-exists $parameter]} {dict set options $key [wapp-param $parameter]}
    }
    set samples [::ashstore::rows $::fixture_db $id samples]
    set stats [::ashstore::rows $::fixture_db $id sqlstats]
    set report {}
    foreach {key cursor} {sql ash_sqldetails sessions ash_sqlsessions events ash_sqlevents} {
        dict set report $key [::ashreplay::query pg $cursor $samples $stats $metadata $options]
    }
    if {[dict exists $options sql_id]} {
        dict set report sql_stats [::ashreplay::query pg ash_sqlstats $samples $stats $metadata $options]
        dict set report sql_overtime [::ashreplay::query pg sqlovertimeload $samples $stats $metadata $options]
        set text [::ashreplay::query pg ash_sqltxt $samples $stats $metadata $options]
        dict set report sql_text [expr {[llength $text] ? [dict get [lindex $text 0] query] : ""}]
    }
    if {[dict exists $options event_id]} {
        dict set report event_sqls [::ashreplay::query pg ash_eventsqls $samples $stats $metadata $options]
    }
    wapp-mimetype application/json
    wapp-reply-extra Cache-Control no-store
    wapp-unsafe [::jobs::ash_report_json $report]
}

puts "Synthetic ASH fixture: $fixture_path"
flush stdout
# A server bound to all addresses but accepting loopback only avoids Wapp's
# -local option opening a browser. It never exposes fixture mutation routes.
wapp-start [list --server $fixture_port --fromip 127.0.0.1]
