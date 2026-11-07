# Minimal real SQL connectivity check. This does not run benchmark workloads.
if {[catch {package require Pgtcl} err]} {
    error "Pgtcl package unavailable: $err"
}
if {![info exists ::env(PGPASSWORD)]} {
    error "PGPASSWORD must be supplied by the temporary CI PostgreSQL service"
}
set conninfo "host=127.0.0.1 port=5432 dbname=postgres user=postgres password=$::env(PGPASSWORD) connect_timeout=10"
set db [pg_connect -conninfo $conninfo]
set result [pg_exec $db {SELECT 1 AS ci_ok}]
set status [pg_result $result -status]
if {$status ne "PGRES_TUPLES_OK"} {
    error "PostgreSQL smoke query failed with $status"
}
set value [lindex [pg_result $result -getTuple 0] 0]
pg_result $result -clear
pg_disconnect $db
if {$value ne "1"} {
    error "Unexpected PostgreSQL query result: $value"
}
puts "HAMMERDB_CI_POSTGRES_PASS"
exit 0
