# MDEV-39563 test wrapper for MariaDB TPROC-C.
#
# Keep the baseline mariaoltp.tcl source verbatim in mariaoltp_base.tcl and
# rewrite only the two NEWORD statement sequences being tested before the
# source is evaluated. This keeps the test branch isolated and makes the
# performance delta attributable to UPDATE ... RETURNING ... INTO.

set _mdev39563_dir [file dirname [info script]]
set _mdev39563_base [file join $_mdev39563_dir mariaoltp_base.tcl]
set _mdev39563_fh [open $_mdev39563_base r]
set _mdev39563_source [read $_mdev39563_fh]
close $_mdev39563_fh

set _mdev39563_old_district {        SELECT d_next_o_id, d_tax INTO no_d_next_o_id, no_d_tax
        FROM district
        WHERE d_id = no_d_id AND d_w_id = no_w_id FOR UPDATE;
        UPDATE district SET d_next_o_id = d_next_o_id + 1 WHERE d_id = no_d_id AND d_w_id = no_w_id;}

set _mdev39563_new_district {        UPDATE district SET d_next_o_id = d_next_o_id + 1
        WHERE d_id = no_d_id AND d_w_id = no_w_id
        RETURNING d_next_o_id - 1, d_tax INTO no_d_next_o_id, no_d_tax;}

set _mdev39563_old_stock {        SELECT s_quantity, s_data, s_dist_01, s_dist_02, s_dist_03, s_dist_04, s_dist_05, s_dist_06, s_dist_07, s_dist_08, s_dist_09, s_dist_10
        INTO no_s_quantity, no_s_data, no_s_dist_01, no_s_dist_02, no_s_dist_03, no_s_dist_04, no_s_dist_05, no_s_dist_06, no_s_dist_07, no_s_dist_08, no_s_dist_09, no_s_dist_10
        FROM stock WHERE s_i_id = no_ol_i_id AND s_w_id = no_ol_supply_w_id;
        IF ( no_s_quantity > no_ol_quantity )
        THEN
        SET no_s_quantity = ( no_s_quantity - no_ol_quantity );
        ELSE
        SET no_s_quantity = ( no_s_quantity - no_ol_quantity + 91 );
        END IF;
        UPDATE stock SET s_quantity = no_s_quantity
        WHERE s_i_id = no_ol_i_id
        AND s_w_id = no_ol_supply_w_id;}

set _mdev39563_new_stock {        UPDATE stock
        SET s_quantity = CASE
        WHEN s_quantity > no_ol_quantity
        THEN s_quantity - no_ol_quantity
        ELSE s_quantity - no_ol_quantity + 91
        END
        WHERE s_i_id = no_ol_i_id
        AND s_w_id = no_ol_supply_w_id
        RETURNING s_quantity, s_data, s_dist_01, s_dist_02, s_dist_03, s_dist_04, s_dist_05, s_dist_06, s_dist_07, s_dist_08, s_dist_09, s_dist_10
        INTO no_s_quantity, no_s_data, no_s_dist_01, no_s_dist_02, no_s_dist_03, no_s_dist_04, no_s_dist_05, no_s_dist_06, no_s_dist_07, no_s_dist_08, no_s_dist_09, no_s_dist_10;}

if {[string first $_mdev39563_old_district $_mdev39563_source] < 0} {
    error "MDEV-39563 test: baseline district block not found in mariaoltp_base.tcl"
}
if {[string first $_mdev39563_old_stock $_mdev39563_source] < 0} {
    error "MDEV-39563 test: baseline stock block not found in mariaoltp_base.tcl"
}

set _mdev39563_source [string map [list \
    $_mdev39563_old_district $_mdev39563_new_district \
    $_mdev39563_old_stock $_mdev39563_new_stock] $_mdev39563_source]

uplevel #0 $_mdev39563_source

unset _mdev39563_dir _mdev39563_base _mdev39563_fh _mdev39563_source
unset _mdev39563_old_district _mdev39563_new_district
unset _mdev39563_old_stock _mdev39563_new_stock
