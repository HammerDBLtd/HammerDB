# PostgreSQL TPROC-C invalid-item rollback regression test
#
# This test patches the currently installed public.neword routine in the
# configured TPROC-C database with the proposed invalid-item check, then
# deterministically forces the TPC-C 1% invalid-item path (item 100001).
# It verifies that the entire New Order is rolled back.
#
# The neword patch is left installed after a successful test so normal
# HammerDB runs can be exercised against it. DBMS_RANDOM is always restored.
#
# Run from the HammerDB root:
#   ./hammerdbcli auto scripts/tcl/postgres/tprocc/pg_tprocc_neworder_rollback_test.tcl

proc pg_test_exec {lda sql} {
    set result [pg_exec $lda $sql]
    set status [pg_result $result -status]
    if {$status ni {PGRES_TUPLES_OK PGRES_COMMAND_OK}} {
        set err [pg_result $result -error]
        pg_result $result -clear
        error $err
    }
    pg_result $result -clear
}

proc pg_test_scalar {lda sql} {
    set result [pg_exec $lda $sql]
    set status [pg_result $result -status]
    if {$status ne "PGRES_TUPLES_OK"} {
        set err [pg_result $result -error]
        pg_result $result -clear
        error $err
    }
    set value [lindex [pg_result $result -list] 0]
    pg_result $result -clear
    return $value
}

proc pg_test_connect {host port sslmode user password dbname} {
    if {[catch {
        set lda [pg_connect -conninfo [list host = $host port = $port sslmode = $sslmode user = $user password = $password dbname = $dbname]]
    } message]} {
        error "Failed to connect to PostgreSQL $host:$port/$dbname: $message"
    }
    set result [pg_exec $lda "set CLIENT_MIN_MESSAGES TO 'ERROR'"]
    pg_result $result -clear
    return $lda
}

proc patch_neword_invalid_item {lda prefer_storedprocs} {
    set rows {}
    pg_select $lda {
        SELECT p.oid, p.prokind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'neword'
          AND p.prokind IN ('f','p')
        ORDER BY p.prokind
    } r {
        lappend rows [list $r(oid) $r(prokind)]
    }

    if {[llength $rows] == 0} {
        error "No public.neword function or procedure found. Build a PostgreSQL TPROC-C schema first."
    }

    set wanted_kind [expr {$prefer_storedprocs eq "true" ? "p" : "f"}]
    set selected {}
    foreach row $rows {
        if {[lindex $row 1] eq $wanted_kind} {
            set selected $row
            break
        }
    }
    if {$selected eq ""} {
        if {[llength $rows] == 1} {
            set selected [lindex $rows 0]
        } else {
            error "Both function and procedure versions of public.neword exist and requested pg_storedprocs=$prefer_storedprocs did not identify one unambiguously."
        }
    }

    lassign $selected neword_oid neword_kind
    set definition [pg_test_scalar $lda "SELECT pg_get_functiondef($neword_oid)"]

    if {[string first "array_position(price_array, NULL)" $definition] >= 0} {
        puts "New Order invalid-item check is already installed."
        return $neword_kind
    }

    set needle "LEFT JOIN item ON i_id = item_id;"
    set pos [string first $needle $definition]
    if {$pos < 0} {
        error "Could not find the PostgreSQL array/UNNEST item lookup in public.neword."
    }

    set insert_at [expr {$pos + [string length $needle]}]
    set invalid_check "\n                IF array_position(price_array, NULL) IS NOT NULL\n                THEN\n                    RAISE NO_DATA_FOUND;\n                END IF;"
    set patched_definition "[string range $definition 0 [expr {$insert_at - 1}]]$invalid_check[string range $definition $insert_at end]"

    pg_test_exec $lda $patched_definition
    puts "Installed invalid-item rollback check in public.neword ([expr {$neword_kind eq "p" ? "procedure" : "function"}])."
    return $neword_kind
}

# Select PostgreSQL TPROC-C and read the configured connection values.
dbset db pg
dbset bm TPROC-C
upvar #0 configpostgresql configpostgresql
setlocaltpccvars $configpostgresql

if {[catch {package require Pgtcl} message]} {
    error "Failed to load Pgtcl: $message"
}

set lda [pg_test_connect $pg_host $pg_port $pg_sslmode $pg_user $pg_pass $pg_dbase]
puts "Testing PostgreSQL TPROC-C New Order invalid-item rollback on $pg_host:$pg_port/$pg_dbase"

set neword_kind [patch_neword_invalid_item $lda $pg_storedprocs]

# Save DBMS_RANDOM exactly as installed so it is restored even if the test fails.
set random_oid [pg_test_scalar $lda {
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'dbms_random'
      AND p.pronargs = 2
    ORDER BY p.oid
    LIMIT 1
}]
set original_random_def [pg_test_scalar $lda "SELECT pg_get_functiondef($random_oid)"]

set test_error ""
try {
    # Returning the lower bound makes rbk=1, therefore the last New Order
    # item is always 100001. Other random choices remain valid and stable.
    pg_test_exec $lda {
        CREATE OR REPLACE FUNCTION DBMS_RANDOM (INTEGER, INTEGER) RETURNS INTEGER AS $$
        DECLARE
            start_int ALIAS FOR $1;
        BEGIN
            RETURN start_int;
        END;
        $$ LANGUAGE 'plpgsql' STRICT
    }

    set w_id 1
    set d_id 1
    set c_id 1
    set ol_cnt 5
    set max_w_id [pg_test_scalar $lda {SELECT max(w_id) FROM warehouse}]

    if {[pg_test_scalar $lda {SELECT count(*) FROM item WHERE i_id = 100001}] != 0} {
        error "ITEM 100001 unexpectedly exists; this schema cannot test the TPC-C invalid-item rollback case."
    }

    set before_next [pg_test_scalar $lda "SELECT d_next_o_id FROM district WHERE d_w_id=$w_id AND d_id=$d_id"]
    set before_orders [pg_test_scalar $lda "SELECT count(*) FROM orders WHERE o_w_id=$w_id AND o_d_id=$d_id AND o_id=$before_next"]
    set before_new_order [pg_test_scalar $lda "SELECT count(*) FROM new_order WHERE no_w_id=$w_id AND no_d_id=$d_id AND no_o_id=$before_next"]
    set before_order_line [pg_test_scalar $lda "SELECT count(*) FROM order_line WHERE ol_w_id=$w_id AND ol_d_id=$d_id AND ol_o_id=$before_next"]
    set before_stock [pg_test_scalar $lda "SELECT s_quantity FROM stock WHERE s_w_id=$w_id AND s_i_id=1"]

    if {$before_orders != 0 || $before_new_order != 0 || $before_order_line != 0} {
        error "Expected test order id $before_next is already present in the schema."
    }

    if {$neword_kind eq "p"} {
        set sql "CALL neword($w_id,$max_w_id,$d_id,$c_id,$ol_cnt,0.0,'','',0.0,0.0,0,current_timestamp::timestamp without time zone)"
    } else {
        set sql "SELECT neword($w_id,$max_w_id,$d_id,$c_id,$ol_cnt,0)"
    }

    set call_result [pg_exec $lda $sql]
    set call_status [pg_result $call_result -status]
    if {$call_status ni {PGRES_TUPLES_OK PGRES_COMMAND_OK PGRES_FATAL_ERROR}} {
        puts "New Order returned status $call_status: [pg_result $call_result -error]"
    }
    pg_result $call_result -clear

    set after_next [pg_test_scalar $lda "SELECT d_next_o_id FROM district WHERE d_w_id=$w_id AND d_id=$d_id"]
    set after_orders [pg_test_scalar $lda "SELECT count(*) FROM orders WHERE o_w_id=$w_id AND o_d_id=$d_id AND o_id=$before_next"]
    set after_new_order [pg_test_scalar $lda "SELECT count(*) FROM new_order WHERE no_w_id=$w_id AND no_d_id=$d_id AND no_o_id=$before_next"]
    set after_order_line [pg_test_scalar $lda "SELECT count(*) FROM order_line WHERE ol_w_id=$w_id AND ol_d_id=$d_id AND ol_o_id=$before_next"]
    set after_stock [pg_test_scalar $lda "SELECT s_quantity FROM stock WHERE s_w_id=$w_id AND s_i_id=1"]
    set invalid_lines [pg_test_scalar $lda {SELECT count(*) FROM order_line WHERE ol_i_id = 100001}]

    set failures {}
    if {$after_next != $before_next} {
        lappend failures "DISTRICT.d_next_o_id changed $before_next -> $after_next"
    }
    if {$after_orders != $before_orders} {
        lappend failures "ORDERS row was committed for order $before_next"
    }
    if {$after_new_order != $before_new_order} {
        lappend failures "NEW_ORDER row was committed for order $before_next"
    }
    if {$after_order_line != $before_order_line} {
        lappend failures "ORDER_LINE rows were committed for order $before_next"
    }
    if {$after_stock != $before_stock} {
        lappend failures "STOCK quantity changed $before_stock -> $after_stock"
    }
    if {$invalid_lines != 0} {
        lappend failures "ORDER_LINE contains $invalid_lines row(s) for invalid item 100001"
    }

    if {[llength $failures] != 0} {
        error "Rollback regression FAILED:\n  [join $failures \n\ \ ]"
    }

    puts "PASS: invalid item 100001 rolled back the complete PostgreSQL New Order transaction."
    puts "Verified: DISTRICT, ORDERS, NEW_ORDER, ORDER_LINE and STOCK were unchanged."
} on error {message options} {
    set test_error $message
} finally {
    if {[catch {pg_test_exec $lda $original_random_def} restore_error]} {
        append test_error "\nAdditionally failed to restore DBMS_RANDOM: $restore_error"
    } else {
        puts "Restored original DBMS_RANDOM definition."
    }
}

pg_disconnect $lda

if {$test_error ne ""} {
    error $test_error
}
