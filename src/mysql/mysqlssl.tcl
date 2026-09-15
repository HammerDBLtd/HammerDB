# Override the MySQL SSL option handling after mysqlopt.tcl is loaded.
# mysqltcl supports -ssl true without CA/certificate files.
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

    # SSL enabled with no certificate configuration: let mysqltcl negotiate TLS.
    if { $mysql_ssl_ca eq "" && $mysql_ssl_cert eq "" && $mysql_ssl_key eq "" } {
        set mysql_ssl_options " -ssl true "
        if { $mysql_ssl_cipher != "server" } {
            append mysql_ssl_options " -sslcipher $mysql_ssl_cipher "
        }
        return
    }

    # Certificate configuration supplied: retain the existing validation path.
    if { ![ file isdirectory $capath ] } {
        tk_messageBox -message "SSL CApath is not a valid directory, disabling SSL"
        dict set configmysql connection mysql_ssl "false"
        return
    }

    if { ![ file readable [ file join $capath $mysql_ssl_ca ]] } {
        tk_messageBox -message "[ file join $capath $mysql_ssl_ca ] is not readable, disabling SSL"
        dict set configmysql connection mysql_ssl "false"
        return
    }

    if { $mysql_ssl_two_way eq "true" } {
        foreach sslfile [ list $mysql_ssl_cert $mysql_ssl_key ] {
            if { ![ file readable [ file join $capath $sslfile ]] } {
                tk_messageBox -message "[ file join $capath $sslfile ] is not readable, disabling SSL"
                dict set configmysql connection mysql_ssl "false"
                return
            }
        }
    }

    set mysql_ssl_options " -ssl true "
    append mysql_ssl_options " -sslca [ file join $capath $mysql_ssl_ca ] "
    if { $mysql_ssl_two_way eq "true" } {
        append mysql_ssl_options " -sslcert [ file join $capath $mysql_ssl_cert ] "
        append mysql_ssl_options " -sslkey [ file join $capath $mysql_ssl_key ] "
    }
    if { $mysql_ssl_cipher != "server" } {
        append mysql_ssl_options " -sslcipher $mysql_ssl_cipher "
    }
}
