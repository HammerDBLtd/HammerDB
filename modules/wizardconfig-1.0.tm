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

    proc odbc_drivers {} {
        if {[catch {package require tdbc::odbc; set drivers [tdbc::odbc::drivers]}]} {
            return [dict create status unverified names {}]
        }
        return [dict create status known names [lsort [dict keys $drivers]]]
    }

    proc condition {name args} {
        return [huddle create name $name values [huddle list {*}$args]]
    }

    proc flag {extra key} {
        if {![dict exists $extra $key]} {return 0}
        set value [dict get $extra $key]
        if {[huddle isHuddle $value]} {set value [huddle get_stripped $value]}
        return [string is true -strict $value]
    }

    proc field {config group name role label type {required 0} {options {}} {extra {}}} {
        if {![dict exists $config $group $name]} {return ""}
        # A password descriptor allows new session input, never the configured
        # password.  File references are explicitly distinguished from secrets.
        set secret [flag $extra secret]
        set path [flag $extra path_reference]
        if {[regexp -nocase {pass|secret|token|private|ssl_key} $name] && !$secret && !$path} {return ""}
        if {$secret || ($path && [string match *_ssl_key $name])} {
            set value ""
        } else {set value [dict get $config $group $name]}
        # A nominally non-secret setting may itself contain a connection URI,
        # Oracle user/password@service string, or an ODBC password attribute.
        # Do not return those persisted values to the browser as form defaults.
        if {($path && [regexp {[\r\n]|-----BEGIN} $value]) ||
            ($role eq "endpoint" && [string first @ $value] >= 0) ||
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
        if {$type eq "checkbox"} {
            huddle set result true_value true
            huddle set result false_value false
        }
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
                set tls [condition ${prefix}_ssl [huddle true]]
                set two_way [condition ${prefix}_ssl_two_way [huddle true]]
                set tls_extra [dict create condition $tls advanced [huddle true]]
                add fields $config connection ${prefix}_ssl_two_way tls "Two-way TLS (client certificate)" checkbox 0 {} $tls_extra
                set capath ${prefix}_ssl_linux_capath
                if {$platform eq "windows"} {set capath ${prefix}_ssl_windows_capath}
                set path_extra [dict merge $tls_extra [dict create path_reference [huddle true] sensitive_path [huddle true]]]
                add fields $config connection $capath tls "TLS CA directory on HammerDB host (optional)" text 0 {} $path_extra
                add fields $config connection ${prefix}_ssl_ca tls "TLS CA file reference (optional)" text 0 {} $path_extra
                # The native certificate/key names are path references.  No file
                # is opened here, and PEM content is never returned as a default.
                set mutual_extra [dict merge $path_extra [dict create \
                    conditions [huddle list $tls $two_way] \
                    clear_when [huddle list $tls [condition ${prefix}_ssl_two_way [huddle false]]] inactive_value ""]]
                dict unset mutual_extra condition
                add fields $config connection ${prefix}_ssl_cert tls "TLS client certificate file reference" text 1 {} $mutual_extra
                add fields $config connection ${prefix}_ssl_key tls "TLS private-key file reference (not key contents)" text 1 {} $mutual_extra
                add fields $config connection ${prefix}_ssl_cipher tls "TLS cipher (server uses client default)" text 0 {} $tls_extra
            }
            ora {
                add fields $config connection instance endpoint "Oracle connection string / service" text 1
                add fields $config connection rac advanced "RAC global transaction counter" checkbox 0 {} \
                    [dict create advanced [huddle true] true_value [huddle number 1] false_value [huddle number 0]]
                add fields $config connection system_user admin_username "Oracle system / monitoring user" text 1
                add fields $config connection system_password password "Oracle system / monitoring password" password 0 {} \
                    [dict create secret [huddle true]]
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
                add fields $config connection mssqls_pass password "SQL password" password 0 {} \
                    [dict create condition [condition $auth sql] secret [huddle true]]
                add fields $config connection mssqls_azure advanced "Azure SQL database connection" checkbox 0 {} \
                    [dict create advanced [huddle true]]
                add fields $config connection mssqls_msi_object_id advanced "Entra managed-identity object ID (null selects interactive)" text 0 {} \
                    [dict create condition [condition $auth entra] advanced [huddle true]]
                add fields $config connection mssqls_encrypt_connection tls "Encrypt connection" checkbox
                add fields $config connection mssqls_trust_server_cert tls "Trust server certificate" checkbox
            }
            db2 { }
        }
        # Workload-specific connection identities, using the same configuration
        # groups as diset and the Desktop connection page.
        if {$prefix eq "ora"} {
            set stem [expr {$group eq "tpcc" ? "tpcc" : "tpch"}]
            add fields $config $group ${stem}_user database "Benchmark schema / user" text 1
            add fields $config $group ${stem}_pass password "Benchmark user password" password 0 {} \
                [dict create secret [huddle true]]
        } elseif {$prefix ne "mssqls"} {
            set stem $prefix
            if {$group eq "tpch"} {append stem _tpch}
            add fields $config $group ${stem}_user username "Benchmark username" text 1
            add fields $config $group ${stem}_pass password "Benchmark user password" password 0 {} \
                [dict create secret [huddle true]]
            set role database
            set label "Benchmark database"
            if {$prefix eq "db2"} {
                set role endpoint_database
                set label "Catalogued benchmark database alias"
            }
            add fields $config $group ${stem}_dbase $role $label text 1
            if {$prefix eq "pg"} {
                set admin_extra [dict create operations [huddle list buildschema checkschema deleteschema]]
                # TPROC-C optional vacuum uses the same administrative context.
                if {$group eq "tpcc"} {dict set admin_extra operations [huddle list buildschema checkschema run deleteschema]}
                add fields $config $group ${stem}_superuser admin_username "Schema-operation administrative user" text 1 {} $admin_extra
                add fields $config $group ${stem}_superuserpass password "Schema-operation administrative password" password 0 {} \
                    [dict merge $admin_extra [dict create secret [huddle true]]]
                add fields $config $group ${stem}_defaultdbase admin_database "Administrative connection database" text 1 {} $admin_extra
            }
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
            set timed [condition ${prefix}_driver timed]
            set timed_extra [dict create condition $timed advanced [huddle true]]
            add fields $config $group ${p}count_ware scale "Warehouses" number 1
            add fields $config $group ${p}num_vu builder_vu "Schema-building virtual users" number 1
            add fields $config $group ${prefix}_driver driver "Driver mode" select 1 {timed test}
            add fields $config $group ${p}total_iterations advanced "Maximum transactions per virtual user" number 1 {} \
                [dict create advanced [huddle true]]
            foreach {suffix role label} {
                rampup rampup {Ramp-up (minutes)} duration duration {Duration (minutes)}
            } {
                add fields $config $group ${p}$suffix $role $label number 1 {} [dict create condition $timed]
            }
            foreach {suffix label} {
                keyandthink {Key and think time} allwarehouse {All warehouses}
                timeprofile {Time profile reporting}
            } {
                # Oracle calls its time-profile flag ora_timeprofile.
                set name ${p}$suffix
                if {$prefix eq "ora" && $suffix eq "timeprofile"} {set name ora_timeprofile}
                set extra [dict create advanced [huddle true]]
                if {$suffix ne "keyandthink"} {set extra $timed_extra}
                add fields $config $group $name advanced $label checkbox 0 {} $extra
            }
            add fields $config $group ${p}raiseerror advanced "Stop on database error" checkbox 0 {} \
                [dict create advanced [huddle true]]
            # The Desktop timed driver requires key/think behavior for async
            # clients, and disables async controls entirely for the test driver.
            set thinking [condition ${p}keyandthink [huddle true]]
            set async_extra [dict create advanced [huddle true] conditions [huddle list $timed $thinking]]
            add fields $config $group ${p}async_scale advanced "Asynchronous scaling (requires key and think time)" checkbox 0 {} $async_extra
            set async_enabled [condition ${p}async_scale [huddle true]]
            set async_children [dict create advanced [huddle true] \
                conditions [huddle list $timed $thinking $async_enabled]]
            add fields $config $group ${p}async_client advanced "Asynchronous clients per virtual user" number 1 {} $async_children
            add fields $config $group ${p}async_delay advanced "Asynchronous client login delay (ms)" number 0 {} \
                [dict merge $async_children [dict create min [huddle number 0]]]
            add fields $config $group ${p}async_verbose advanced "Asynchronous verbose output" checkbox 0 {} $async_children
            add fields $config $group ${p}prepared advanced "Prepared statements" checkbox 0 {} \
                [dict create advanced [huddle true]]
            add fields $config $group ${p}vacuum advanced "Vacuum after run" checkbox 0 {} $timed_extra
            add fields $config $group ${p}checkpoint advanced "Checkpoint after run" checkbox 0 {} $timed_extra
        } else {
            # Existing CLI buildschema scale factors, not a new benchmark range.
            add fields $config $group ${p}scale_fact scale "Scale factor" select 1 \
                {1 10 30 100 300 1000 3000 10000 30000 100000}
            add fields $config $group ${p}num_tpch_threads builder_vu "Schema-building virtual users" number 1
            add fields $config $group ${p}total_querysets querysets "Query sets per virtual user" number 1
            add fields $config $group ${p}degree_of_parallel advanced "Query degree of parallelism" number 1 {} \
                [dict create advanced [huddle true]]
            add fields $config $group ${p}refresh_on advanced "Enable refresh operations" checkbox 0 {} \
                [dict create advanced [huddle true]]
            set refresh_extra [dict create advanced [huddle true] \
                condition [condition ${p}refresh_on [huddle true]]]
            add fields $config $group ${p}update_sets advanced "Refresh update sets" number 1 {} $refresh_extra
            add fields $config $group ${p}trickle_refresh advanced "Refresh delay (ms)" number 0 {} \
                [dict merge $refresh_extra [dict create min [huddle number 0]]]
            add fields $config $group ${p}refresh_verbose advanced "Refresh verbose output" checkbox 0 {} $refresh_extra
            add fields $config $group ${p}raise_query_error advanced "Stop on query error" checkbox 0 {} \
                [dict create advanced [huddle true]]
            add fields $config $group ${p}verbose advanced "Verbose query output" checkbox 0 {} \
                [dict create advanced [huddle true]]
        }
        return [huddle list {*}$fields]
    }

    proc metadata {} {
        global dbdict genericdict tcl_platform
        set databases {}
        set odbc [odbc_drivers]
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
                set native_status unverified
                set selected_driver ""
                if {$prefix eq "mssqls"} {
                    set driver_key mssqls_linux_odbc
                    if {$tcl_platform(platform) eq "windows"} {set driver_key mssqls_odbc_driver}
                    set driver_field [field $config connection $driver_key advanced "ODBC driver" text]
                    if {$driver_field ne ""} {set selected_driver [huddle get_stripped $driver_field default]}
                    if {[dict get $odbc status] eq "known"} {
                        set native_status [expr {$selected_driver in [dict get $odbc names] ? "available" : "unavailable"}]
                    }
                }
                lappend databases [huddle create id $prefix label $label library_status $status \
                    adapter_status $status native_driver_status $native_status selected_native_driver $selected_driver \
                    workloads $workloads]
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
            autopilot_sequence [huddle list {*}$sequence] avu_min [huddle number 1] avu_max [huddle null] \
            credential_modes [huddle list session profile] credential_mode session profiles [huddle list]]
        return [huddle jsondump [huddle create api_version 1 preview [huddle true] \
            custom_execution [huddle false] databases [huddle list {*}$databases] generic $generic \
            installed_odbc_drivers [huddle list {*}[dict get $odbc names]]]]
    }
}
