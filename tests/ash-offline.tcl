# Explicit archive smoke test: no database server/client is used by this script.
# Usage: tclsh tests/ash-offline.tcl /path/to/captured-jobs.db JOBID
if {[llength $argv] != 2} {
    puts stderr "Usage: tclsh tests/ash-offline.tcl captured-jobs.db JOBID"
    exit 2
}
::tcl::tm::path add [file join [file dirname [file dirname [file normalize [info script]]]] modules]
package require sqlite3
package require jobs
package require ashstore
lassign $argv archive jobid
set channel [file tempfile copy_path]
close $channel
try {
    sqlite3 archived $archive -readonly 1
    # VACUUM INTO creates a consistent snapshot including committed WAL data.
    # The source remains read-only; the destination is our empty temporary file.
    archived eval {VACUUM INTO $copy_path}
    archived close
    sqlite3 ::jobs::hdbjobs $copy_path
    ::ashstore::init ::jobs::hdbjobs
    set metadata [::ashstore::metadata ::jobs::hdbjobs $jobid]
    if {$metadata eq "" || [dict get $metadata state] ne "complete"} {
        error "A completed ASH archive is required"
    }
    set options [dict create begin [dict get $metadata run_start] end [dict get $metadata run_end]]
    set report [::jobs::ash_report $jobid $options]
    if {![dict get $report available] || [dict get $report sample_count] < 1} {
        error "Historical ASH samples are unavailable"
    }
    if {[string length [::jobs::ash_report_json $report]] < 100} {
        error "Historical ASH JSON report is missing"
    }
    puts "PASS offline [dict get $metadata database]: [dict get $report sample_count] samples, [llength [dict get $report chart]] chart rows"
} finally {
    catch {archived close}
    catch {::jobs::hdbjobs close}
    file delete -force $copy_path ${copy_path}-wal ${copy_path}-shm
}
