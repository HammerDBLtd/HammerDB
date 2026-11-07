# Keep HammerDB's established awbreeze / awbreezedark colours.  The
# modern spacing, typography and widget styling share the native grey
# chrome, black/white work areas and orange interaction accent.
proc hdbcolor {name {theme ""}} {
    if {$theme eq ""} {set theme $::ttk::currentTheme}
    set background [ttk::style lookup TFrame -background]
    if {$background eq ""} {
        if {[string match "*dark*" $theme]} {
            set background #424242
        } else {
            set background #eff0f1
        }
    }
    if {[string match "*dark*" $theme]} {
        set palette [dict create \
            background $background panel $background field black \
            foreground white muted #b0b0b0 border #626262 \
            hover #505050 selection #484848 focus #FF7900 \
            brand #FF7900 disabled #808080 success #528723 \
            warning #edb926 error #E94F64]
    } else {
        set palette [dict create \
            background $background panel $background field white \
            foreground black muted #626262 border #b8babf \
            hover #d3d4d8 selection LightGray focus #FF7900 \
            brand #FF7900 disabled #808080 success green \
            warning #edb926 error red]
    }
    return [dict get $palette $name]
}

# Scale presentation dimensions from 96-DPI logical pixels. Fonts remain in
# points and use Tk's native platform families.
proc hdbspace {values} {
    set scaled {}
    foreach value $values {
        lappend scaled [expr {round($value * [tk scaling] / (96.0 / 72.0))}]
    }
    return $scaled
}

proc hdbfonts {} {
    # Re-resolve point sizes after the configured tk scaling is applied.
    # Retain native families/sizes instead of shrinking Linux fonts.
    foreach name [font names] {
        font configure $name -size [font actual $name -size]
    }
    foreach {name source weight} {
        basic TkDefaultFont normal
        HDBHeadingFont TkDefaultFont bold
        HDBCodeFont TkFixedFont normal
    } {
        if {$name ni [font names]} {font create $name}
        font configure $name {*}[font actual $source] -weight $weight
    }
}

proc tilestyle { defaultBackground icons theme } {
    set fieldbackground [hdbcolor field $theme]
    set foreground [hdbcolor foreground $theme]
    set panel [hdbcolor panel $theme]
    set border [hdbcolor border $theme]
    set focus [hdbcolor focus $theme]
    set selection [hdbcolor selection $theme]
    set muted [hdbcolor muted $theme]
    set disabled [hdbcolor disabled $theme]

    ttk::style configure . -font TkDefaultFont
    ttk::style configure TFrame -background $defaultBackground -borderwidth 0 -relief flat
    ttk::style configure TLabel -padding [hdbspace {2 2}]
    ttk::style configure TButton -font TkDefaultFont -relief flat -anchor center
    ttk::style configure TLabelframe -padding [hdbspace {8 6}] -relief flat
    ttk::style configure TLabelframe.Label -font HDBHeadingFont -foreground $muted
    ttk::style configure TNotebook -borderwidth 0 -tabmargins [hdbspace {2 4 2 0}]
    ttk::style configure TNotebook.Tab -padding [hdbspace {10 6}] -font TkDefaultFont
    ttk::style configure TPanedwindow -background $defaultBackground
    ttk::style configure HDBToolbar.TFrame -padding [hdbspace {2 2}]
    ttk::style configure HDBMenubar.TFrame -padding [hdbspace {2 1}]
    ttk::style configure HDBStatus.TLabel -foreground $muted -padding [hdbspace {2 3}]
    ttk::style configure Heading -font HDBHeadingFont
    # As before, the tree and entry controls use the native grey surface in
    # dark mode, while text editors and metrics keep their black work areas.
    set treebackground $fieldbackground
    set treeselection $defaultBackground
    set entrybackground $fieldbackground
    if {[string match "*dark*" $theme]} {
        set treebackground $defaultBackground
        set treeselection black
        set entrybackground $defaultBackground
    }
    ttk::style configure Treeview -background $treebackground \
        -fieldbackground $treebackground -foreground $foreground -borderwidth 0
    ttk::style map Treeview -background [list selected $treeselection] \
        -foreground [list disabled $disabled selected [hdbcolor brand $theme]]
    ttk::style configure Treeview.Heading -background $panel -foreground $muted \
        -font HDBHeadingFont -padding [hdbspace {8 6}]
    ttk::style configure TProgressbar -troughcolor $panel -background [hdbcolor brand] \
        -lightcolor [hdbcolor brand] -darkcolor [hdbcolor brand] -borderwidth 0
    foreach style {TEntry TSpinbox TCombobox} {
        ttk::style configure $style -font TkTextFont -fieldbackground $entrybackground \
            -foreground $foreground -selectbackground $selection \
            -selectforeground $foreground -insertcolor $foreground
        ttk::style map $style -foreground [list disabled $disabled readonly $foreground] \
            -fieldbackground [list disabled $panel readonly $entrybackground]
    }

    # Option defaults cover classic widgets without replacing their classes,
    # bindings, validation commands, or explicit application settings.
    foreach widget {Toplevel Frame Label Button Checkbutton Radiobutton} {
        option add *${widget}.background $defaultBackground widgetDefault
        option add *${widget}.foreground $foreground widgetDefault
        option add *${widget}.font TkDefaultFont widgetDefault
        option add *${widget}.highlightBackground $border widgetDefault
        option add *${widget}.highlightColor $focus widgetDefault
    }
    foreach widget {Button Checkbutton Radiobutton} {
        option add *${widget}.activeBackground $selection widgetDefault
        option add *${widget}.activeForeground $foreground widgetDefault
        option add *${widget}.disabledForeground $disabled widgetDefault
        option add *${widget}.relief flat widgetDefault
        option add *${widget}.borderWidth 0 widgetDefault
    }
    option add *Button.background $panel widgetDefault
    option add *Button.highlightThickness 1 widgetDefault
    option add *Button.padX [hdbspace 10] widgetDefault
    option add *Button.padY [hdbspace 5] widgetDefault
    foreach widget {Text Listbox Entry Spinbox} {
        option add *${widget}.background $fieldbackground widgetDefault
        option add *${widget}.foreground $foreground widgetDefault
        option add *${widget}.selectBackground $selection widgetDefault
        option add *${widget}.selectForeground $foreground widgetDefault
        option add *${widget}.highlightBackground $border widgetDefault
        option add *${widget}.highlightColor $focus widgetDefault
        option add *${widget}.selectBorderWidth 0 widgetDefault
        option add *${widget}.relief flat widgetDefault
        option add *${widget}.borderWidth 0 widgetDefault
    }
    option add *Text.insertBackground $foreground widgetDefault
    option add *Text.inactiveSelectBackground $selection widgetDefault
    option add *Text.font HDBCodeFont widgetDefault
    option add *Listbox.font TkTextFont widgetDefault
    option add *Menu.font TkMenuFont widgetDefault
    option add *h1.font HDBHeadingFont widgetDefault
    option add *h2.font HDBHeadingFont widgetDefault
    foreach {key colour} {
        bg field cursor foreground stdin foreground stdout focus
        stderr error prompt muted proc success var warning disabled disabled
    } {
        set ::tkcon::COLOR($key) [hdbcolor $colour]
    }

    # tooltip documents labelOpts as its presentation override, set before
    # the first registration. Keep its timing and bindings unchanged.
    set ::tooltip::labelOpts [list -font TkDefaultFont -background $panel \
        -foreground $foreground -relief flat -borderwidth 0 \
        -highlightthickness 1 -highlightbackground $border \
        -padx [hdbspace 8] -pady [hdbspace 5]]

    # Keep the existing menu widget and traversal. Use the same restrained
    # orange outline in both themes, including keyboard focus.
    foreach {state fill stroke} [list normal $defaultBackground $defaultBackground \
            hover $panel [hdbcolor brand] pressed $selection [hdbcolor brand]] {
        set name ::img::hdbmenu-$state
        if {$name in [image names]} {image delete $name}
        image create photo $name -format svg -data \
            "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><rect x='0.5' y='0.5' width='11' height='11' rx='2' fill='$fill' stroke='$stroke' stroke-width='1'/></svg>"
    }
    if {"HDBMenu.border" ni [ttk::style element names]} {
        ttk::style element create HDBMenu.border image [list \
            ::img::hdbmenu-normal \
            {pressed !disabled} ::img::hdbmenu-pressed \
            {active !disabled} ::img::hdbmenu-hover \
            {focus !disabled} ::img::hdbmenu-hover] -border 3 -sticky nswe
    }
    ttk::style layout HDBMenu.Toolbutton {
        HDBMenu.border -sticky nswe -children {
            Button.padding -sticky nswe -children {
                Button.label -sticky nswe
            }
        }
    }
    ttk::style configure HDBMenu.Toolbutton -font TkMenuFont -foreground $foreground \
        -background $defaultBackground -padding [hdbspace {6 4}]
    ttk::style map HDBMenu.Toolbutton -foreground [list disabled $disabled]
}

proc framesizes { win_scale_fact } {
    global tabix tabiy mainx mainy mainminx mainminy mainmaxx mainmaxy
    set tabix [ expr {round(481.2 * $win_scale_fact)} ]
    set tabiy [ expr {round(240.6 * $win_scale_fact)} ]
    set mainx [ expr {round(610 * $win_scale_fact)} ]
    set mainy [ expr {round(482.7 * $win_scale_fact)} ]
    set mainminx [ expr {round(248.1 * $win_scale_fact)} ]
    set mainminy [ expr {round(240.6 * $win_scale_fact)} ]
    set mainmaxx [ expr {round(744.3 * $win_scale_fact)} ]
    set mainmaxy [ expr {round(556.4 * $win_scale_fact)} ]
}

proc initscaletheme {theme pixelsperpoint} {
    global tcl_platform defaultBackground defaultForeground win_scale_fact treewidth
    upvar #0 icons icons
    upvar #0 iconalt iconalt
    upvar #0 iconssvg iconssvg
    upvar #0 iconaltsvg iconaltsvg
    package require colorutils
    package require awthemes
    ::themeutils::setHighlightColor $theme "#FF7900"
    ::themeutils::setThemeColors $theme graphics.color #FF7900 focus.color #FF7900
    # Restore the native awbreeze/awbreezedark backgrounds and widget
    # colours. Only keep the original orange highlights and the branch's
    # new padding/tab metrics; do not override the base palette.
    if {![string match "*dark*" $theme]} {
        ::themeutils::setThemeColors $theme \
            scrollbar.active #d3d4d8 scrollbar.color #b8babf \
            scrollbar.pressed #FF7900 scrollbar.trough #eff0f1
    } else {
        ::themeutils::setThemeColors $theme \
            scrollbar.active #d3d4d8 \
            scrollbar.color [ttk::style lookup TFrame -background] \
            scrollbar.pressed #FF7900 scrollbar.trough black
    }
    ::themeutils::setThemeColors $theme \
        button.padding {10 4} button.image.padding {4 3} \
        entry.padding {3 0} entry.image.padding {6 4} \
        combobox.padding {3 0} combobox.entry.image.padding {6 4} \
        spinbox.image.padding {4 4} \
        checkbutton.padding {4 3 2 3} radiobutton.padding {4 3 2 3} \
        checkbutton.focusthickness 1 radiobutton.focusthickness 1 \
        menu.relief flat tab.color.selected #FF7900 tab.color.hover #FF7900
    ::themeutils::setThemeColors $theme \
        style.progressbar rounded-line \
        style.scale circle-rev \
        style.scrollbar-grip none \
        scrollbar.has.arrows false
    #Window Scaling Factor
    if { $pixelsperpoint eq "auto" } {
        #Use system detect value
        set win_scale_fact [ tk scaling ]
    } else {
        #pixelsperpoint has been set to a floating point number
        #between 1.33 and 3.99 by the user
        #set scaling value to this user value
        set win_scale_fact $pixelsperpoint	
        tk scaling $win_scale_fact
    }
    hdbfonts
    package require $theme
    ttk::setTheme $theme
    configmessagebox $theme
    #png icons
    set iconset iconicgray
    set icons [ create_icon_images $iconset ]
    set iconhighlight iconicorange
    set iconalt [ create_icon_images $iconhighlight ]
    #svg icons
	if { ![ string match "*dark*" $theme ] } {
    set iconsetsvg iconicgraysvg
	} else {
    set iconsetsvg iconicwhitesvg
	}
    set iconssvg [ create_icon_images $iconsetsvg ]
    set iconhighlightsvg iconicorangesvg
    set iconaltsvg [ create_icon_images $iconhighlightsvg ]
    set defaultBackground [ ttk::style lookup TFrame -background ]
    set defaultForeground [hdbcolor foreground $theme]
    dict set icons defaultBackground $defaultBackground
    dict set icons defaultForeground $defaultForeground
    dict set iconssvg defaultBackground $defaultBackground
    dict set iconssvg defaultForeground $defaultForeground
    #Set Tile styles
    tilestyle $defaultBackground $icons $theme
    ttk::style configure Treeview -rowheight \
        [expr {[font metrics TkDefaultFont -linespace] + [hdbspace 6]}]
    set treewidth [expr {round(1.677 * [winfo pixels . 1i])}]
    framesizes $win_scale_fact
}

proc configmessagebox { theme } {
    global tcl_platform
    namespace import ::msgcat::*
    set ::ttk_message_box_return_value "ok"
    namespace eval ::ttk::dialog_module {
        variable invalid_default_button_error [mc "Invalid default button \"%s\"."]
        variable italic_font [font create ttk_message_dialog_Italic_font {*}[font actual TkDefaultFont] -slant italic]
        variable unrecognized_parameter [mc "Unrecognized parameter: %s"]
        variable unrecognized_parameter_input [mc "Unrecognized input for %s parameter."]
        variable window_icon ""
        variable window_name ""
    }

    proc ::ttk::centralize_window {window_widget} {

        wm withdraw $window_widget
        update

        set total_height [winfo screenheight .]
        set total_width [winfo screenwidth .]

        set window_height [winfo reqheight $window_widget]
        set window_width [winfo reqwidth $window_widget]


        set height_center [ expr ($total_height - $window_height) /2]
        set width_center [ expr ($total_width - $window_width) / 2]

        wm geometry  $window_widget ${window_width}x${window_height}+$width_center+$height_center
        wm deiconify $window_widget
    }

    proc ::ttk::messageBox args {
        #Always call the Linux version even on Windows to override Windows defaults
        ttk::unix_messageBox {*}$args
    }

    proc ::ttk::unix_messageBox args {
        variable ::ttk::dialog_module::unrecognized_parameter
        variable ::ttk::dialog_module::unrecognized_parameter_input
        variable ::ttk::dialog_module::window_name

        set detail_string {}
        set message_string {}

        set symbolic_button_name {}
        set window_icon_type info
        set window_identifier [expr int(rand() * 10000)]
        set window_name .window_${window_identifier}
        set window_title {}

        #What kind of buttons will be grid?
        set grid_type ok
        set default_button {}
        set index 0
        set last_item [llength $args]

        for {set index 0} {$index < $last_item} {set index [expr $index + 2]} {
            set token [lindex $args $index]
            set parameter [lindex $args [expr $index + 1]]

            switch $token {
                -default {
                    set default_button [validate_parameter $parameter {ok abort retry ignore yes no}]
                } 
                -detail {
                    set detail_string $parameter
                } 
                -icon {
                    set window_icon_type [validate_parameter $parameter {error info question warning}]
                } 
                -message {
                    set message_string $parameter
                } 
                -parent {
                    if {$parameter != "."} {
                        set window_name ${parameter}.window_${window_identifier}
                    }
                } 
                -title {
                    set window_title $parameter
                } 
                -type {
                    set grid_type [ \
					validate_parameter \
					$parameter \
					{abortretryignore ok okcancel retrycancel yesno yesnocancel}
                    ]
                } 
                default {
                    error [format $unrecognized_argument $token]
                }
            }
        }

        if {$default_button != ""} {
            if {![::ttk::unix_messageBox_check_default_parameter $default_button]} {
                return
            }
        }

        ::ttk::unix_messageBox_draw \
		$window_icon_type \
		$window_title \
		$message_string \
		$detail_string \
		$grid_type \
		$default_button 

        return ${::ttk_message_box_return_value}
    }

    #Checks if the -default parameter, if set, is set correctly
    proc ::ttk::unix_messageBox_check_default_parameter {default_button} {
        variable ::ttk::dialog_module::invalid_default_button_error 
        set ok 1

        if {!($default_button in {ok yes no cancel ignore abort retry})} {
            return -code error [format  $invalid_default_button_error $default_button]
        }
        return $ok
    }

    proc ::ttk::unix_messageBox_draw { \
	window_icon_type \
	window_title \
	message_text \
	details_text \
	grid_type \
	default_focus \
} {
        variable ::ttk::dialog_module::window_icon
        variable ::ttk::dialog_module::window_name
        variable ::ttk::dialog_module::italic_font
        set vertical_padding [hdbspace {12 0}]
        set horizontal_padding [hdbspace 4]
        # Service status and error reports can contain very long paths/lines.
        # Bound the text rather than letting its requested width size the
        # entire dialog beyond the display.
        set text_width [expr {min([hdbspace 640], int([winfo screenwidth .] * 0.70))}]

        ttk::toplevel $window_name 
        wm transient $window_name .ed_mainFrame
        wm title $window_name $window_title

        ttk::frame $window_name.top_frame -padding [hdbspace {4 4}]
        #upvar #0 icons icons
        switch $window_icon_type {
            error {
                set window_icon [create_image error icons ]
            }
            info {
                set window_icon [create_image information icons ]
            }
            question {
                set window_icon [create_image question icons ]
            }
            warning {
                set window_icon [create_image warning icons ]
            }
            default {
                set window_icon [create_image information icons ]
            }
        }

        if {$details_text != ""} {
            label $window_name.top_frame.details_label -text "${details_text}\n" \
		-font $italic_font -wraplength $text_width -justify left
        } \
	else {
            label $window_name.top_frame.details_label -text {}
        }

        ttk::label $window_name.top_frame.icon_label -image $window_icon
        ttk::label $window_name.top_frame.message_label -text $message_text \
            -wraplength $text_width -justify left
        ttk::frame $window_name.top_frame.button_frame 

        #First set of buttons: abort, retry and ignore.
        button $window_name.top_frame.button_frame.abort_button \
	-text [mc "Abort"] -width 10 -command {::ttk::unix_messageBox_quit "abort"}


        button $window_name.top_frame.button_frame.ignore_button \
	-text [mc "Ignore"] -width 10 -command {::ttk::unix_messageBox_quit "ignore"}

        button $window_name.top_frame.button_frame.retry_button \
	-text [mc "Retry"] -width 10 -command {::ttk::unix_messageBox_quit "retry"}

        #Second set of buttons: yes and no.
        button $window_name.top_frame.button_frame.yes_button \
	-text [mc "Yes"] -width 10 -command {::ttk::unix_messageBox_quit "yes"}


        button $window_name.top_frame.button_frame.no_button \
	-text [mc "No"] -width 10 -command {::ttk::unix_messageBox_quit "no"}


        #Third set of buttons: ok and cancel.
        button $window_name.top_frame.button_frame.ok_button \
	-text [mc "Ok"] -width 10 -command {::ttk::unix_messageBox_quit "ok"}

        button $window_name.top_frame.button_frame.cancel_button \
	-text [mc "Cancel"] -width 10 -command  {::ttk::unix_messageBox_quit "cancel"}

        grid $window_name.top_frame -row 0 -column 0 -sticky news 
        grid $window_name.top_frame.icon_label -row 0 -column 0 -padx [hdbspace {0 10}] -sticky n
        grid $window_name.top_frame.message_label -row 0 -column 1 -sticky w
        grid $window_name.top_frame.details_label -row 1 -column 1 -sticky w -pady [hdbspace {4 0}]
        grid $window_name.top_frame.button_frame -row 2 -column 0 -columnspan 2

        switch $grid_type {
            abortretryignore {
                grid $window_name.top_frame.button_frame.abort_button -row 0 -column 0  -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.retry_button -row 0 -column 1  -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.ignore_button -row 0 -column 2  -pady $vertical_padding -padx $horizontal_padding 
            } 
            ok {
                grid $window_name.top_frame.button_frame.ok_button -row 0 -column 0 \
			-sticky we -padx 5 -pady $vertical_padding
            } 
            okcancel {
                grid $window_name.top_frame.button_frame.ok_button -row 0 -column 0 -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.cancel_button -row 0 -column 1  -pady $vertical_padding -padx $horizontal_padding 
            } 
            retrycancel {
                grid $window_name.top_frame.button_frame.retry_button -row 0 -column 0  -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.cancel_button -row 0 -column 1  -pady $vertical_padding -padx $horizontal_padding 
            } 
            yesno {
                grid $window_name.top_frame.button_frame.yes_button -row 0 -column 0 -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.no_button -row 0 -column 1  -pady $vertical_padding -padx $horizontal_padding 
            } 
            yesnocancel {
                grid $window_name.top_frame.button_frame.yes_button -row 0 -column 0  -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.no_button -row 0 -column 1 -pady $vertical_padding -padx $horizontal_padding 
                grid $window_name.top_frame.button_frame.cancel_button -row 0 -column 2  -pady $vertical_padding -padx $horizontal_padding 
            }
        }

        # Wrapping alone can turn a long service environment into a very tall
        # dialog. Keep every character available in a scrollable, read-only
        # report when it would otherwise exceed the usable display height.
        update idletasks
        set max_height [expr {min([hdbspace 540], int([winfo screenheight .] * 0.75))}]
        if {[winfo reqheight $window_name] > $max_height} {
            set body $window_name.top_frame.report
            ttk::frame $body
            set line_height [font metrics HDBCodeFont -linespace]
            set chrome_height [expr {2 * [$window_name cget -pady] + [hdbspace 16] +
                [winfo reqheight $window_name.top_frame.button_frame]}]
            set lines [expr {max(3, int(($max_height - $chrome_height) / $line_height))}]
            set columns [expr {max(1, int($text_width / [font measure HDBCodeFont 0]))}]
            text $body.text -font HDBCodeFont -wrap word -width $columns -height $lines -takefocus 1 \
                -highlightthickness 1 -highlightbackground [hdbcolor border] \
                -yscrollcommand [list $body.scroll set]
            ttk::scrollbar $body.scroll -orient vertical -command [list $body.text yview]
            $body.text insert end $message_text
            if {$details_text ne ""} {$body.text insert end "\n\n$details_text"}
            $body.text configure -state disabled
            grid $body.text -row 0 -column 0 -sticky news
            grid $body.scroll -row 0 -column 1 -sticky ns
            grid rowconfigure $body 0 -weight 1
            grid columnconfigure $body 0 -weight 1
            grid remove $window_name.top_frame.message_label $window_name.top_frame.details_label
            grid $body -row 0 -column 1 -rowspan 2 -sticky news
            grid rowconfigure $window_name 0 -weight 1
            grid columnconfigure $window_name 0 -weight 1
            grid rowconfigure $window_name.top_frame 0 -weight 1
            grid columnconfigure $window_name.top_frame 1 -weight 1
        }

        switch $default_focus {
            ok {
                focus  $window_name.top_frame.button_frame.ok_button
            } 
            cancel {
                focus  $window_name.top_frame.button_frame.cancel_button
            } 
            abort {
                focus  $window_name.top_frame.button_frame.abort_button
            }
            retry {
                focus  $window_name.top_frame.button_frame.retry_button
            }
            ignore {
                focus  $window_name.top_frame.button_frame.ignore_button
            }
            yes {
                focus  $window_name.top_frame.button_frame.yes_button
            }
            no {
                focus  $window_name.top_frame.button_frame.no_button
            }
            cancel {
                focus  $window_name.top_frame.button_frame.cancel_button
            }
        }
        ::ttk::centralize_window $window_name

        wm protocol $window_name WM_DELETE_WINDOW  {::ttk::unix_messageBox_quit "ok"}
        vwait ::ttk_message_box_return_value
    }

    #Check if parameter is any of the list, and if so, returns it.
    proc ::ttk::validate_parameter {input_parameter input_list} {
        variable ::ttk::dialog_module::unrecognized_parameter_input 

        if {!($input_parameter in $input_list)} {
            return -code error [format $unrecognized_parameter_input $input_parameter]
        }

        return $input_parameter
    }

    proc ::ttk::unix_messageBox_quit {return_value} {
        variable ::ttk::dialog_module::window_name

        set ::ttk_message_box_return_value $return_value

        if {[info exist window_name]} {
            destroy $window_name
        }

        if {[info exist ${::ttk::dialog_module::window_icon}]} {
            image delete ${::ttk::dialog_module::window_icon}
        }
        return
    }
}

#Load SQLite before first use
package require sqlite3
#Get a temporary copy of the generic settings to configure the display
set dirname [ find_config_dir ]
if { $dirname eq "FNF" } {
        set theme "dark"
        set tmpgendict {}
} else {
if { [ file exists $dirname/generic.xml ] } {
set tmpgendict [ ::XML::To_Dict $dirname/generic.xml ]
	} else {
set tmpgendict {}
	}
if { [ dict exists $tmpgendict theme scaletheme ] } {
        set theme [dict get $tmpgendict theme scaletheme ]
	} else {
        set theme "dark"
	}
}
#Get sqlitedb_dir from generic.xml
if { [ dict exists $tmpgendict sqlitedb sqlitedb_dir ] } {
        set sqlitedb_dir [ dict get $tmpgendict sqlitedb sqlitedb_dir ]
	set tmpgenericdictdb [ SQLite2Dict "generic" ]
#Replace theme from XML with theme from SQLite generic dict
if { [ dict exists $tmpgenericdictdb theme scaletheme ] } {
        set theme [ dict get $tmpgenericdictdb theme scaletheme ]
        }
}
	if { $theme eq "light" } { set theme "awbreeze" }
	if { $theme eq "dark" } { set theme "awbreezedark" }
        if { $theme ni {awbreeze awbreezedark} } {
            #Options for Windows and Linux in case default is changed in future awtheme
            if {$tcl_platform(platform) == "windows"} {
                set theme "awbreezedark"
            } else {
                set theme "awbreezedark"
            }
        }
        if { [ dict exists $tmpgendict theme pixelsperpoint ] } {
        set pixelsperpoint [dict get $tmpgendict theme pixelsperpoint ]
	} else {
        set pixelsperpoint "auto"
	}
        if { $pixelsperpoint eq "auto" } {
            ;# Use detected value of tk scaling
        } else {
            if {![string is double $pixelsperpoint] } {
                #pixelsperpoint is not a floating point number
                set pixelsperpoint "auto"
            } else {
                if { $pixelsperpoint < 1.33 || $pixelsperpoint > 3.99 } {
                    #pixelsperpoint set to invalid value
                    set pixelsperpoint "auto"
                }
            }
        }
        rename tk_messageBox _tk_messageBox
        proc tk_messageBox {args} {
            global jobid
            variable ::ttk::dialog_module::window_name
	    #Uncomment to include message box messages in Jobs
            #hdbjobs eval {INSERT INTO JOBOUTPUT VALUES($jobid, 0, $args)}
            if [ winfo exists $window_name ] {
                raise $window_name
                if [ llength $::ttk::dialog_module::args ] {
                    if [ dict exists $::ttk::dialog_module::args -title ] {
                        set message "Warning: [ dict get $::ttk::dialog_module::args -title ] dialog is already open, close it first"
                    } else {
                        set message "Warning: a dialog is already open, close it first"
                    }
                    puts $message
                    #hdbjobs eval {INSERT INTO JOBOUTPUT VALUES($jobid, 0, $message)}
                }
                return
            } else {
                set ::ttk::dialog_module::args $args
                bell
                ttk::messageBox {*}$args
            }
        }
        initscaletheme $theme $pixelsperpoint
        unset -nocomplain tmpgendict
