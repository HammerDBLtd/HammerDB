# Invoked through a newly built HammerDB CLI from a full source build.
if {![info exists ::hdb_version] || ![regexp {^v[0-9]+\.[0-9]+\.[0-9]+$} $::hdb_version]} {
    error "Invalid or missing HammerDB version"
}
foreach command {dbset diset giset loadscript vuset vucreate librarycheck jobs} {
    if {[llength [info commands $command]] != 1} {
        error "Missing HammerDB CLI command $command"
    }
}
if {![info exists ::dbdict]} {
    error "Database catalogue is unavailable"
}
set prefixes [list]
dict for {database attributes} $::dbdict {
    lappend prefixes [dict get $attributes prefix]
}
foreach prefix {ora mssqls db2 mysql pg maria vsql} {
    if {$prefix ni $prefixes} {
        error "Missing database prefix: $prefix"
    }
}
puts "HAMMERDB_CI_CLI_PASS $::hdb_version"
exit 0
