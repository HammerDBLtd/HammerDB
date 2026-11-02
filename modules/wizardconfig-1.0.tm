# Read-only presentation metadata for the Stage 1 Pipeline wizard.  These are
# existing configuration names, not a second execution/capability validator.
package require Tcl 9.0
package require huddle
package provide wizardconfig 1.0

namespace eval wizardconfig {
    # Loading a client library does not open a database connection.  Keep the
    # error text private: native loader diagnostics can include local paths.
    proc library_status {specification} {
        if {[catch {package require {*}$specification}]} {return unavailable}
        return available
    }

    proc field {config group name role label type {required 0} {options {}} {extra {}}} {
        if {![dict exists $config $group $name]} {return ""}
        # Never serialize authentication material, even if a future descriptor
        # accidentally includes a secret configuration key.
        if {[regexp -nocase {pass|secret|token|private|ssl_key} $name]} {return ""}
        set value [dict get $config $group $name]
        # A nominally non-secret setting may itself contain a connection URI,
        # Oracle user/password@service string, or an ODBC password attribute.
        # Do not return those persisted values to the browser as form defaults.
        if {($role eq "endpoint" && [string first @ $value] >= 0) ||
            [regexp -nocase {(://[^/[:space:]]*@)|((pwd|password|passwd|secret|token|authorization|credential)[[:space:]]*[=:])|((^|[[:space:]])[^/@[:space:]]+/[^/@[:space:]]+@)} $value]} {
            set value ""
        }
        switch -- $type {
            checkbox {set value [huddle boolean [expr {[string is true -strict $value]}]]}
            number {
                if {[string is integer -strict $value]} {set value [huddle number $value]}
            }
        }
        set result [huddle create name $name group $group role $role label $label \
            default $value type $type required [huddle boolean $required]]
        if {[llength $options]} {huddle set result options [huddle list {*}$options]}
        dict for {key val} $extra {huddle set result $key $val}
        return $result
    }

    proc add {listvar config group name role label type {required 0} {options {}} {extra {}}} {
        upvar 1 $listvar fields
        set item [field $config $group $name $role $label $type $required $options $extra]
        if {$item ne ""} {lappend fields $item}
    }

    proc connection_fields {prefix config group platform} {
        set fields {}
        switch -- $prefix {
            pg {
                add fields $config connection pg_host endpoint "Host" text 1
                add fields $config connection pg_port port "Port" number 1
                add fields $config connection pg_sslmode tls "SSL mode" select 1 \
                    {disable allow prefer require verify-ca verify-full}
            }
            mysql - maria - vsql {
                add fields $config connection ${prefix}_host endpoint "Host" text 1
                add fields $config connection ${prefix}_port port "Port" number 1
                add fields $config connection ${prefix}_socket socket "Local socket (optional)" text 0 {} \
                    [dict create local_only [huddle true]]
                add fields $config connection ${prefix}_ssl tls "Use TLS" checkbox
            }
            ora {
                add fields $config connection instance endpoint "Oracle connection string / service" text 1
                add fields $config connection rac advanced "Oracle RAC" checkbox
            }
            mssqls {
                if {$platform eq "windows"} {
                    set server mssqls_server
                    set auth mssqls_authentication
                    set odbc mssqls_odbc_driver
                } else {
                    set server mssqls_linux_server
                    set auth mssqls_linux_authent
                    set odbc mssqls_linux_odbc
                }
                add fields $config connection $server endpoint "SQL Server" text 1
                add fields $config connection mssqls_tcp advanced "Use TCP" checkbox
                add fields $config connection mssqls_port port "TCP port" number 1 {} \
                    [dict create condition [huddle create name mssqls_tcp values [huddle list [huddle true]]]]
                add fields $config connection $odbc advanced "ODBC driver" text 1
                add fields $config connection $auth authentication "Authentication" select 1 {windows sql entra}
                add fields $config connection mssqls_uid username "SQL username" text 1 {} \
                    [dict create condition [huddle create name $auth values [huddle list sql]]]
                add fields $config connection mssqls_encrypt_connection tls "Encrypt connection" checkbox
                add fields $config connection mssqls_trust_server_cert tls "Trust server certificate" checkbox
            }
            db2 {
                add fields $config connection db2_def_dbase endpoint "Catalogued Db2 database alias" text 1
            }
        }
        # Existing workload dictionaries contain schema/database and benchmark
        # users.  Passwords and privileged credentials stay in an operator profile.
        if {$prefix eq "ora"} {
            set stem [expr {$group eq "tpcc" ? "tpcc" : "tpch"}]
            add fields $config $group ${stem}_user database "Benchmark schema / user" text 1
        } elseif {$prefix ne "mssqls"} {
            set stem $prefix
            if {$group eq "tpch"} {append stem _tpch}
            add fields $config $group ${stem}_user username "Benchmark username" text 1
            add fields $config $group ${stem}_dbase database "Benchmark database" text 1
        } else {
            set name [expr {$group eq "tpcc" ? "mssqls_dbase" : "mssqls_tpch_dbase"}]
            add fields $config $group $name database "Benchmark database" text 1
        }
        return [huddle list {*}$fields]
    }

    proc setting_fields {prefix config group} {
        set fields {}
        # Oracle's established warehouse and timing names have no prefix.
        set p [expr {$prefix eq "ora" ? "" : "${prefix}_"}]
        if {$group eq "tpcc"} {
            add fields $config $group ${p}count_ware scale "Warehouses" number 1
            add fields $config $group ${p}num_vu builder_vu "Schema-building virtual users" number 1
            add fields $config $group ${prefix}_driver driver "Driver mode" select 1 {timed test}
            foreach {suffix role label} {
                rampup rampup {Ramp-up (minutes)} duration duration {Duration (minutes)}
            } {
                add fields $config $group ${p}$suffix $role $label number 1 {} \
                    [dict create condition [huddle create name ${prefix}_driver values [huddle list timed]]]
            }
            foreach {suffix label} {
                keyandthink {Key and think time} allwarehouse {All warehouses}
                timeprofile {Time profile reporting}
            } {
                # Oracle calls its time-profile flag ora_timeprofile.
                set name ${p}$suffix
                if {$prefix eq "ora" && $suffix eq "timeprofile"} {set name ora_timeprofile}
                add fields $config $group $name advanced $label checkbox 0 {} \
                    [dict create advanced [huddle true]]
            }
        } else {
            # Existing CLI buildschema scale factors, not a new benchmark range.
            add fields $config $group ${p}scale_fact scale "Scale factor" select 1 \
                {1 10 30 100 300 1000 3000 10000 30000 100000}
            add fields $config $group ${p}num_tpch_threads builder_vu "Schema-building virtual users" number 1
            add fields $config $group ${p}total_querysets querysets "Query sets per virtual user" number 1
            add fields $config $group ${p}refresh_on advanced "Enable refresh operations" checkbox 0 {} \
                [dict create advanced [huddle true]]
        }
        return [huddle list {*}$fields]
    }

    proc metadata {} {
        global dbdict genericdict tcl_platform
        set databases {}
        if {[info exists dbdict]} {
            dict for {database descriptor} $dbdict {
                if {![dict exists $descriptor prefix] || ![dict exists $descriptor workloads]} continue
                set prefix [dict get $descriptor prefix]
                if {![info exists ::config$database]} continue
                set config [set ::config$database]
                set workloads [huddle create]
                foreach {code group native} {C tpcc TPC-C H tpch TPC-H} {
                    set listed [string map {TPROC- TPC-} [dict get $descriptor workloads]]
                    if {$native ni $listed || ![dict exists $config $group]} continue
                    huddle set workloads $code [huddle create \
                        connection [connection_fields $prefix $config $group $tcl_platform(platform)] \
                        settings [setting_fields $prefix $config $group]]
                }
                set status unavailable
                if {[dict exists $descriptor library]} {
                    set status [library_status [dict get $descriptor library]]
                }
                set label [dict get $descriptor name]
                if {[dict exists $descriptor description]} {set label [dict get $descriptor description]}
                lappend databases [huddle create id $prefix label $label library_status $status workloads $workloads]
            }
        }
        set virtual_users 1
        set sequence {}
        if {[info exists genericdict]} {
            if {[dict exists $genericdict virtual_user_options virtual_users]} {
                set configured [dict get $genericdict virtual_user_options virtual_users]
                if {[string is integer -strict $configured] && $configured >= 1} {set virtual_users $configured}
            }
            if {[dict exists $genericdict autopilot autopilot_sequence]} {
                foreach value [dict get $genericdict autopilot autopilot_sequence] {
                    if {[string is integer -strict $value] && $value >= 1} {lappend sequence [huddle number $value]}
                }
            }
        }
        # vuset vu enforces a positive integer but defines no maximum; leave the
        # admission/resource maximum unknown for the enhanced CI capabilities.
        set generic [huddle create virtual_users [huddle number $virtual_users] \
            autopilot_sequence [huddle list {*}$sequence] avu_min [huddle number 1] avu_max [huddle null]]
        return [huddle jsondump [huddle create api_version 1 preview [huddle true] \
            custom_execution [huddle false] databases [huddle list {*}$databases] generic $generic]]
    }
}
