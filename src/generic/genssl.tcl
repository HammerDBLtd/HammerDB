# Shared SSL option overrides for MySQL-compatible drivers.
#
# When SSL is enabled for a one-way connection and CApath, CA, cert and key are
# all blank, request TLS with -ssl true only. This allows encrypted connections
# without requiring an explicit CA file. Existing CApath-only, CA-verified and
# two-way certificate behaviour is preserved.

proc check_mysql_ssl { configdict } {
    global mysql_ssl_options
    unset -nocomplain mysql_ssl_options
    upvar #0 configmysql configmysql

    foreach key [ dict keys [ dict get $configdict connection ] *ssl* ] {
        set $key [ dict get $configdict connection $key ]
    }

    if {![string match windows $::tcl_platform(platform)]} {
        set capath $mysql_ssl_linux_capath
    } else {
        set capath $mysql_ssl_windows_capath
    }

    if { $mysql_ssl != "true" } {
        set mysql_ssl_options " -ssl false "
        return
    }

    set no_ssl_files [ expr {$mysql_ssl_ca eq "" && $mysql_ssl_cert eq "" && $mysql_ssl_key eq ""} ]

    # One-way TLS without certificate verification. No CA path or files are
    # supplied, so leave mysqltcl to negotiate TLS with -ssl true only.
    if { $mysql_ssl_two_way ne "true" && $no_ssl_files && $capath eq "" } {
        append mysql_ssl_options " -ssl true "
        if { $mysql_ssl_cipher != "server" } {
            append mysql_ssl_options " -sslcipher $mysql_ssl_cipher "
        }
        return
    }

    # All other SSL modes retain the existing CApath validation behaviour.
    if { ![ file isdirectory $capath ] } {
        tk_messageBox -message "SSL CApath is not a valid directory, disabling SSL"
        dict set configmysql connection mysql_ssl "false"
        return
    }

    if { !$no_ssl_files } {
        if { ![ file readable [ file join $capath $mysql_ssl_ca ] ] } {
            tk_messageBox -message "[ file join $capath $mysql_ssl_ca ] is not readable, disabling SSL"
            dict set configmysql connection mysql_ssl "false"
            return
        }
        if { $mysql_ssl_two_way eq "true" } {
            foreach sslfile [ list $mysql_ssl_cert $mysql_ssl_key ] {
                if { ![ file readable [ file join $capath $sslfile ] ] } {
                    tk_messageBox -message "[ file join $capath $sslfile ] is not readable, disabling SSL"
                    dict set configmysql connection mysql_ssl "false"
                    return
                }
            }
        }
    }

    append mysql_ssl_options " -ssl true "
    if { $no_ssl_files } {
        append mysql_ssl_options " -sslcapath $capath "
    } else {
        append mysql_ssl_options " -sslca [ file join $capath $mysql_ssl_ca ] "
        if { $mysql_ssl_two_way eq "true" } {
            append mysql_ssl_options " -sslcert [ file join $capath $mysql_ssl_cert ] "
            append mysql_ssl_options " -sslkey [ file join $capath $mysql_ssl_key ] "
        }
    }
    if { $mysql_ssl_cipher != "server" } {
        append mysql_ssl_options " -sslcipher $mysql_ssl_cipher "
    }
}

proc check_vsql_ssl { configdict } {
    global vsql_ssl_options
    unset -nocomplain vsql_ssl_options
    upvar #0 configvillagesql configvillagesql

    foreach key [ dict keys [ dict get $configdict connection ] *ssl* ] {
        set $key [ dict get $configdict connection $key ]
    }

    if {![string match windows $::tcl_platform(platform)]} {
        set capath $vsql_ssl_linux_capath
    } else {
        set capath $vsql_ssl_windows_capath
    }

    if { $vsql_ssl != "true" } {
        set vsql_ssl_options " -ssl false "
        return
    }

    set no_ssl_files [ expr {$vsql_ssl_ca eq "" && $vsql_ssl_cert eq "" && $vsql_ssl_key eq ""} ]

    # One-way TLS without certificate verification. No CA path or files are
    # supplied, so leave mysqltcl to negotiate TLS with -ssl true only.
    if { $vsql_ssl_two_way ne "true" && $no_ssl_files && $capath eq "" } {
        append vsql_ssl_options " -ssl true "
        if { $vsql_ssl_cipher != "server" } {
            append vsql_ssl_options " -sslcipher $vsql_ssl_cipher "
        }
        return
    }

    # All other SSL modes retain the existing CApath validation behaviour.
    if { ![ file isdirectory $capath ] } {
        tk_messageBox -message "SSL CApath is not a valid directory, disabling SSL"
        dict set configvillagesql connection vsql_ssl "false"
        return
    }

    if { !$no_ssl_files } {
        if { ![ file readable [ file join $capath $vsql_ssl_ca ] ] } {
            tk_messageBox -message "[ file join $capath $vsql_ssl_ca ] is not readable, disabling SSL"
            dict set configvillagesql connection vsql_ssl "false"
            return
        }
        if { $vsql_ssl_two_way eq "true" } {
            foreach sslfile [ list $vsql_ssl_cert $vsql_ssl_key ] {
                if { ![ file readable [ file join $capath $sslfile ] ] } {
                    tk_messageBox -message "[ file join $capath $sslfile ] is not readable, disabling SSL"
                    dict set configvillagesql connection vsql_ssl "false"
                    return
                }
            }
        }
    }

    append vsql_ssl_options " -ssl true "
    if { $no_ssl_files } {
        append vsql_ssl_options " -sslcapath $capath "
    } else {
        append vsql_ssl_options " -sslca [ file join $capath $vsql_ssl_ca ] "
        if { $vsql_ssl_two_way eq "true" } {
            append vsql_ssl_options " -sslcert [ file join $capath $vsql_ssl_cert ] "
            append vsql_ssl_options " -sslkey [ file join $capath $vsql_ssl_key ] "
        }
    }
    if { $vsql_ssl_cipher != "server" } {
        append vsql_ssl_options " -sslcipher $vsql_ssl_cipher "
    }
}

proc check_maria_ssl { configdict } {
    global maria_ssl_options
    unset -nocomplain maria_ssl_options
    upvar #0 configmariadb configmariadb

    foreach key [ dict keys [ dict get $configdict connection ] *ssl* ] {
        set $key [ dict get $configdict connection $key ]
    }

    if {![string match windows $::tcl_platform(platform)]} {
        set capath $maria_ssl_linux_capath
    } else {
        set capath $maria_ssl_windows_capath
    }

    if { $maria_ssl != "true" } {
        set maria_ssl_options " -ssl false "
        return
    }

    set no_ssl_files [ expr {$maria_ssl_ca eq "" && $maria_ssl_cert eq "" && $maria_ssl_key eq ""} ]

    # One-way TLS without certificate verification. No CA path or files are
    # supplied, so leave mariatcl to negotiate TLS with -ssl true only.
    if { $maria_ssl_two_way ne "true" && $no_ssl_files && $capath eq "" } {
        append maria_ssl_options " -ssl true "
        if { $maria_ssl_cipher != "server" } {
            append maria_ssl_options " -sslcipher $maria_ssl_cipher "
        }
        return
    }

    # All other SSL modes retain the existing CApath validation behaviour.
    if { ![ file isdirectory $capath ] } {
        tk_messageBox -message "SSL CApath is not a valid directory, disabling SSL"
        dict set configmariadb connection maria_ssl "false"
        return
    }

    if { !$no_ssl_files } {
        # MariaDB already permits cert+key without a CA file. Preserve that
        # behaviour while validating a CA whenever one is explicitly supplied.
        if { $maria_ssl_ca ne "" && ![ file readable [ file join $capath $maria_ssl_ca ] ] } {
            tk_messageBox -message "[ file join $capath $maria_ssl_ca ] is not readable, disabling SSL"
            dict set configmariadb connection maria_ssl "false"
            return
        }
        if { $maria_ssl_two_way eq "true" } {
            foreach sslfile [ list $maria_ssl_cert $maria_ssl_key ] {
                if { ![ file readable [ file join $capath $sslfile ] ] } {
                    tk_messageBox -message "[ file join $capath $sslfile ] is not readable, disabling SSL"
                    dict set configmariadb connection maria_ssl "false"
                    return
                }
            }
        }
    }

    append maria_ssl_options " -ssl true "
    if { $no_ssl_files } {
        append maria_ssl_options " -sslcapath $capath "
    } else {
        if { $maria_ssl_ca ne "" } {
            append maria_ssl_options " -sslca [ file join $capath $maria_ssl_ca ] "
        }
        if { $maria_ssl_two_way eq "true" } {
            append maria_ssl_options " -sslcert [ file join $capath $maria_ssl_cert ] "
            append maria_ssl_options " -sslkey [ file join $capath $maria_ssl_key ] "
        }
    }
    if { $maria_ssl_cipher != "server" } {
        append maria_ssl_options " -sslcipher $maria_ssl_cipher "
    }
}
