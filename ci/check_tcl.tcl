# Check Tcl source completeness without evaluating the application.
# Tcl 8.6 is sufficient for lexical validation of Tcl 9 project files.
set failed 0
set checked 0
foreach path $argv {
    if {[catch {set handle [open $path r]} err]} {
        puts stderr "FAIL: Cannot open $path: $err"
        incr failed
        continue
    }
    fconfigure $handle -encoding utf-8
    if {[catch {set source [read $handle]} err]} {
        puts stderr "FAIL: Cannot read $path: $err"
        incr failed
    } elseif {![info complete $source]} {
        puts stderr "FAIL: Incomplete Tcl source (unbalanced brace/quote): $path"
        incr failed
    }
    close $handle
    incr checked
}
if {$failed > 0} {
    puts stderr "FAIL: $failed of $checked Tcl sources failed"
    exit 1
}
puts "PASS: $checked Tcl sources are complete"
