# Override the MariaDB SSL option handling after mariaopt.tcl is loaded.
# mariatcl supports SSL without CA/certificate files.
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

    # SSL enabled with no certificate configuration: let mariatcl negotiate TLS.
    if { $maria_ssl_ca eq "" && $maria_ssl_cert eq "" && $maria_ssl_key eq "" } {
        set maria_ssl_options " -ssl true "
        if { $maria_ssl_cipher != "server" } {
            append maria_ssl_options " -sslcipher $maria_ssl_cipher "
        }
        return
    }

    # Certificate configuration supplied: retain the existing validation path.
    if { ![ file isdirectory $capath ] } {
        tk_messageBox -message "SSL CApath is not a valid directory, disabling SSL"
        dict set configmariadb connection maria_ssl "false"
        return
    }

    # MariaDB also allows cert+key without a CA file for non-verifying/self-signed use.
    if { $maria_ssl_ca ne "" && ![ file readable [ file join $capath $maria_ssl_ca ]] } {
        tk_messageBox -message "[ file join $capath $maria_ssl_ca ] is not readable, disabling SSL"
        dict set configmariadb connection maria_ssl "false"
        return
    }

    if { $maria_ssl_two_way eq "true" } {
        foreach sslfile [ list $maria_ssl_cert $maria_ssl_key ] {
            if { ![ file readable [ file join $capath $sslfile ]] } {
                tk_messageBox -message "[ file join $capath $sslfile ] is not readable, disabling SSL"
                dict set configmariadb connection maria_ssl "false"
                return
            }
        }
    }

    set maria_ssl_options " -ssl true "
    if { $maria_ssl_ca ne "" } {
        append maria_ssl_options " -sslca [ file join $capath $maria_ssl_ca ] "
    }
    if { $maria_ssl_two_way eq "true" } {
        append maria_ssl_options " -sslcert [ file join $capath $maria_ssl_cert ] "
        append maria_ssl_options " -sslkey [ file join $capath $maria_ssl_key ] "
    }
    if { $maria_ssl_cipher != "server" } {
        append maria_ssl_options " -sslcipher $maria_ssl_cipher "
    }
}
