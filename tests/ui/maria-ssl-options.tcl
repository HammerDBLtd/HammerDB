# Standalone MariaDB TLS option regression checks.
# Run from the repository root: tclsh tests/ui/maria-ssl-options.tcl
source [file join [file dirname [file dirname [file dirname [info script]]]] src mariadb mariaopt.tcl]

proc tk_messageBox {args} {
    error "Unexpected MariaDB TLS configuration error: $args"
}
proc assert_option {expected label} {
    set actual [join [regexp -all -inline {\S+} $::maria_ssl_options] " "]
    if {$actual ne $expected} {
        error "$label: expected '$expected', got '$actual'"
    }
}
set ::configmariadb [dict create connection [dict create \
    maria_ssl true maria_ssl_two_way false \
    maria_ssl_linux_capath "" maria_ssl_windows_capath "" \
    maria_ssl_ca "" maria_ssl_cert "" maria_ssl_key "" maria_ssl_cipher server]]

check_maria_ssl $::configmariadb
assert_option "-ssl true" "one-way TLS without files"

# Legacy GUI placeholders must not become bogus paths.
dict set ::configmariadb connection maria_ssl_ca "{}"
check_maria_ssl $::configmariadb
assert_option "-ssl true" "legacy empty placeholder"

# Stale client certificate filenames are irrelevant to one-way TLS.
dict set ::configmariadb connection maria_ssl_cert "client-cert.pem"
dict set ::configmariadb connection maria_ssl_key "client-key.pem"
check_maria_ssl $::configmariadb
assert_option "-ssl true" "one-way TLS ignores mutual TLS inputs"

dict set ::configmariadb connection maria_ssl false
check_maria_ssl $::configmariadb
assert_option "-ssl false" "TLS disabled"

# Explicit readable CA remains supported.
set tmp [file join [pwd] ".maria-tls-test-[pid]"]
file mkdir $tmp
try {
    set fh [open [file join $tmp ca.pem] w]
    puts $fh "certificate placeholder - only file readability is tested"
    close $fh
    dict set ::configmariadb connection maria_ssl true
    dict set ::configmariadb connection maria_ssl_ca "ca.pem"
    dict set ::configmariadb connection maria_ssl_linux_capath $tmp
    dict set ::configmariadb connection maria_ssl_windows_capath $tmp
    check_maria_ssl $::configmariadb
    assert_option "-ssl true -sslca [file join $tmp ca.pem]" "explicit CA"
} finally {
    file delete -force -- $tmp
}

proc gui_normalizer_test {} {
    set maria_ssl_ca "{}"
    set maria_ssl_cert "keep-cert.pem"
    maria_ssl_normalize_gui_fields
    if {$maria_ssl_ca ne "" || $maria_ssl_cert ne "keep-cert.pem"} {
        error "GUI must normalize legacy empty fields without deleting real values"
    }
}
gui_normalizer_test
puts "MariaDB TLS option regression checks passed"
