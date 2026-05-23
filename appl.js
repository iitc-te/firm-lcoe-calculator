
// ─── Globals ────────────────────────────────────────────────────────────────

var server_data = {};

var MARKER_RADIUS_PX = 12;
var SESSION_KEY      = "rtc_session";

var currentLat = null,
    currentLon = null;

// ─── Progress bar ────────────────────────────────────────────────────────────

var progressbar = {

    init: function () {
        jQuery("#offcanvas")
            .find(".progress-bar")
            .css("width", "0%")
            .attr("aria-valuenow", 0)
            .removeClass("progress-bar-striped progress-bar-animated");
    },

    busy: function () {
        jQuery("#offcanvas")
            .find(".progress-bar")
            .css("width", "100%")
            .attr("aria-valuenow", 100)
            .addClass("progress-bar-striped progress-bar-animated");
    }

};

// ─── Message box ─────────────────────────────────────────────────────────────

var msgbox = {

    hide: function () {
        jQuery('#msgbox').modal('hide');
    },

    show: function (html) {
        jQuery('#msgbox').modal('show');
        jQuery('#msgbox').find('.msgboxContent').html(html || '');
    },

    show_html: function (icon, text) {
        this.show('<i class="bi ' + icon + '"></i> &nbsp; ' + text);
    },

    success: function (text) {
        this.show_html('bi-check2-circle', text);
    },

    failure: function (text) {
        this.show_html('bi-x-circle', text);
    },

    info: function (text) {
        this.show_html('bi-info-circle', text);
    },

    behave: function () {
        jQuery(document).on('keydown', function (e) {
            if (e.which === 27) {
                e.preventDefault();
                msgbox.hide();
            }
        });
    }

};

// ─── Area chart (d3) ─────────────────────────────────────────────────────────

var areaChart = {

    clear: function () {
        d3.select("#chart-container").selectAll("*").remove();
    },

    plot: function (uc, vmin, vmax) {

        this.clear();

        if (!uc) return;

        // ── Series definitions (order = stack order) ──────────────────────

        var candidates = [
            { key: "solr",     label: "Solar",              color: "#F2BE4A", type: "area",
              values: uc.solr.map(function (v) { return v || 0; }) },
            { key: "wind",     label: "Wind",               color: "#4E79A7", type: "area",
              values: uc.wind.map(function (v) { return v || 0; }) },
            { key: "bess_dis", label: "BESS Discharge",     color: "#59A14F", type: "area",
              values: uc.bess.map(function (v) { return Math.max(v || 0, 0); }) },
            { key: "nspo",     label: "Non-Supplied Power", color: "#E15759", type: "area",
              values: uc.nspo.map(function (v) { return v || 0; }) },
            { key: "curt",     label: "Curtailment",        color: "#E0E0E0", type: "area",
              values: uc.curt.map(function (v) { return v || 0; }) },
            { key: "bess_chg", label: "BESS Charge",        color: "#2E7D32", type: "neg-area",
              values: uc.bess.map(function (v) { return Math.min(v || 0, 0); }) }
        ];

        var active = candidates.filter(function (s) {
            return s.values.some(function (v) { return Math.abs(v) > 1e-9; });
        });

        if (active.length === 0) return;

        var activeArea    = active.filter(function (s) { return s.type === "area"; });
        var activeNegArea = active.filter(function (s) { return s.type === "neg-area"; });

        // ── Layout ────────────────────────────────────────────────────────

        var container = document.getElementById("chart-container");
        var W       = container.clientWidth || 800;
        var H       = 600;
        var margin  = { top: 10, right: 20, bottom: 50, left: 65 };
        var legendH = 28;
        var width   = W - margin.left - margin.right;
        var height  = H - margin.top - margin.bottom - legendH;
        var n       = uc.hour.length;

        // ── Row data ──────────────────────────────────────────────────────

        var rowData = uc.hour.map(function (h, i) {
            var row = { hour: h };
            active.forEach(function (s) { row[s.key] = s.values[i]; });
            return row;
        });

        // ── Scales ────────────────────────────────────────────────────────

        var x = d3.scaleLinear()
            .domain([uc.hour[0], uc.hour[n - 1]])
            .range([0, width]);

        var y = d3.scaleLinear()
            .domain([
                (vmin !== undefined ? vmin : d3.min(active, function (s) { return d3.min(s.values); })),
                (vmax !== undefined ? vmax : d3.max(active, function (s) { return d3.max(s.values); }))
            ])
            .range([height, 0]);

        // ── SVG shell ─────────────────────────────────────────────────────

        var svg = d3.select("#chart-container")
            .append("svg")
            .attr("width",  W)
            .attr("height", H)
            .style("font-family", "Figtree, Calibri, Helvetica, sans-serif")
            .style("font-size",   "12px");

        // ── Legend ────────────────────────────────────────────────────────

        var legend = svg.append("g")
            .attr("transform", "translate(" + margin.left + "," + (margin.top + 6) + ")");

        var lx = 0;
        active.forEach(function (s) {

            legend.append("rect")
                .attr("x", lx).attr("y", 2)
                .attr("width", 14).attr("height", 12)
                .attr("fill", s.color)
                .attr("fill-opacity", 0.85);

            var txt = legend.append("text")
                .attr("x", lx + 19)
                .attr("y", 12)
                .attr("fill", "#555")
                .text(s.label);

            lx += 19 + txt.node().getComputedTextLength() + 14;

        });

        // ── Chart group ───────────────────────────────────────────────────

        var g = svg.append("g")
            .attr("transform",
                "translate(" + margin.left + "," + (margin.top + legendH) + ")");

        // Horizontal grid lines
        g.append("g")
            .call(d3.axisLeft(y).tickSize(-width).tickFormat(""))
            .call(function (gg) {
                gg.select(".domain").remove();
                gg.selectAll("line").attr("stroke", "#e0e0e0");
            });

        // ── Stacked areas ─────────────────────────────────────────────────

        if (activeArea.length > 0) {

            var stack = d3.stack()
                .keys(activeArea.map(function (s) { return s.key; }))
                .value(function (d, k) { return d[k] || 0; });

            var stackedData = stack(rowData);

            var area = d3.area()
                .x(function (d)  { return x(d.data.hour); })
                .y0(function (d) { return y(d[0]); })
                .y1(function (d) { return y(d[1]); });

            g.selectAll(".area-layer")
                .data(stackedData)
                .enter()
                .append("path")
                .attr("class", "area-layer")
                .attr("fill", function (d, i) { return activeArea[i].color; })
                .attr("fill-opacity", 0.85)
                .attr("d", area);

        }

        // ── Negative area series (BESS charge – below zero baseline) ─────

        activeNegArea.forEach(function (s) {

            var negArea = d3.area()
                .x(function (d)  { return x(d.hour); })
                .y0(y(0))
                .y1(function (d) { return y(d[s.key]); });

            g.append("path")
                .datum(rowData)
                .attr("fill",         s.color)
                .attr("fill-opacity", 0.85)
                .attr("d",            negArea);

        });

        // Zero baseline (visible when vmin < 0)
        if (vmin < 0) {
            g.append("line")
                .attr("x1", 0).attr("x2", width)
                .attr("y1", y(0)).attr("y2", y(0))
                .attr("stroke", "#aaa")
                .attr("stroke-width", 0.5);
        }

        // ── Axes ──────────────────────────────────────────────────────────

        g.append("g")
            .attr("transform", "translate(0," + height + ")")
            .call(d3.axisBottom(x).ticks(Math.min(n, 8)).tickFormat(d3.format("d")))
            .selectAll("text")
            .style("font-family", "inherit")
            .style("font-size",   "12px");

        g.append("g")
            .call(d3.axisLeft(y))
            .selectAll("text")
            .style("font-family", "inherit")
            .style("font-size",   "12px");

        // Axis labels
        svg.append("text")
            .attr("x", margin.left + width / 2)
            .attr("y", H - 5)
            .attr("text-anchor", "middle")
            .attr("fill", "#555")
            .style("font-size", "12px")
            .text("Hour of the Year");

        svg.append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", -(margin.top + legendH + height / 2))
            .attr("y", 16)
            .attr("text-anchor", "middle")
            .attr("fill", "#555")
            .style("font-size", "12px")
            .text("MWh");

        // ── Tooltip + crosshair ───────────────────────────────────────────

        var tooltip = d3.select("#chart-container")
            .append("div")
            .style("position",       "absolute")
            .style("background",     "rgba(255,255,255,0.95)")
            .style("border",         "1px solid #ddd")
            .style("border-radius",  "4px")
            .style("padding",        "6px 10px")
            .style("font-size",      "12px")
            .style("font-family",    "Figtree, Calibri, Helvetica, sans-serif")
            .style("pointer-events", "none")
            .style("box-shadow",     "0 2px 5px rgba(0,0,0,0.1)")
            .style("display",        "none");

        var crosshair = g.append("line")
            .attr("y1", 0).attr("y2", height)
            .attr("stroke",           "#999")
            .attr("stroke-width",     1)
            .attr("stroke-dasharray", "3,3")
            .style("display",         "none");

        // Invisible overlay that catches mouse events
        svg.append("rect")
            .attr("transform",
                "translate(" + margin.left + "," + (margin.top + legendH) + ")")
            .attr("width",          width)
            .attr("height",         height)
            .attr("fill",           "none")
            .attr("pointer-events", "all")
            .on("mousemove", function (event) {

                var mx       = d3.pointer(event, this)[0];
                var hourVal  = x.invert(mx);

                // Nearest hour index
                var idx = 0, minDist = Infinity;
                for (var i = 0; i < uc.hour.length; i++) {
                    var dist = Math.abs(uc.hour[i] - hourVal);
                    if (dist < minDist) { minDist = dist; idx = i; }
                }

                crosshair
                    .attr("x1", x(uc.hour[idx]))
                    .attr("x2", x(uc.hour[idx]))
                    .style("display", null);

                var html = "<strong>Hour " + uc.hour[idx] + "</strong><br/>";
                active.forEach(function (s) {
                    var val = s.values[idx];
                    if (Math.abs(val) > 1e-9) {
                        html += s.label + ": <strong>" +
                                val.toFixed(1) + "</strong> MWh<br/>";
                    }
                });

                var rect = container.getBoundingClientRect();
                var tx   = event.clientX - rect.left + 14;
                var ty   = event.clientY - rect.top  - 10;

                // Flip left if too close to right edge
                if (tx + 170 > W) tx = event.clientX - rect.left - 180;

                tooltip
                    .style("display", null)
                    .style("left",    tx + "px")
                    .style("top",     ty + "px")
                    .html(html);

            })
            .on("mouseleave", function () {
                crosshair.style("display", "none");
                tooltip.style("display",   "none");
            });

    }

};

// ─── Main document-ready block ───────────────────────────────────────────────

jQuery(document).ready(function () {

    msgbox.behave();

    // ── Map setup ─────────────────────────────────────────────────────────

    var container = d3.select("#map-container"),
        width     = window.innerWidth,
        height    = window.innerHeight;

    var svg = container.append("svg")
        .attr("width",   width)
        .attr("height",  height)
        .attr("viewBox", [0, 0, width, height]);

    var g = svg.append("g");

    var projection = d3.geoMercator()
        .scale(width / 2 / Math.PI)
        .translate([width / 2, height / 1.5]);

    var path = d3.geoPath().projection(projection);

    var zoom = d3.zoom()
        .scaleExtent([1, 8])
        .on("zoom", function (event) {
            g.attr("transform", event.transform);
            g.selectAll(".marker").attr("r", MARKER_RADIUS_PX / event.transform.k);
            g.selectAll(".country").attr("stroke-width", 0.5 / event.transform.k);
        });

    svg.call(zoom);

    // ── Load world map, then attempt session restore ───────────────────────

    d3.json("3p/topojson-client/3.1.0/countries-50m.json")

        .then(function (world) {

            var countries = topojson.feature(world, world.objects.countries);

            g.selectAll("path")
                .data(countries.features)
                .enter()
                .append("path")
                .attr("class", "country")
                .attr("d", path)
                .attr("id", function (d) { return "country-" + d.id; });

            // Restore from share link if present, otherwise from localStorage
            var shareId = new URLSearchParams(window.location.search).get("share");

            if (shareId) {

                jQuery.ajax({
                    url:      "https://responsive.li/api/firm-lcoe-calculator/get/?id=" + encodeURIComponent(shareId),
                    method:   "GET",
                    dataType: "json",
                    success: function (session) {
                        if (session && session.input &&
                            session.input.lolat != null &&
                            session.input.lolon != null) {
                            restoreSession(session);
                            var url = window.location.href.split("?")[0] + "?share=" + shareId;
                            jQuery("#share-url").val(url);
                            jQuery("#btn-copy").prop("disabled", false);
                        }
                    }
                });

            } else {

                var raw = localStorage.getItem(SESSION_KEY);
                if (raw) {
                    try {
                        var session = JSON.parse(raw);
                        if (session && session.input &&
                            session.input.lolat != null &&
                            session.input.lolon != null) {
                            restoreSession(session);
                        }
                    } catch (e) {
                        console.warn("Session restore failed:", e);
                    }
                }

            }

        })

        .catch(function (err) {
            console.error("Error loading map data:", err);
        });

    // ── Map click → place marker → open panel ─────────────────────────────

    svg.on("click", function (event) {

        if (event.target.classList.contains("marker")) return;

        var transform = d3.zoomTransform(svg.node()),
            point     = d3.pointer(event, svg.node());

        var rawX = (point[0] - transform.x) / transform.k,
            rawY = (point[1] - transform.y) / transform.k;

        var coords = projection.invert([rawX, rawY]);
        if (!coords) return;

        var lon = coords[0], lat = coords[1];

        placeMarker(rawX, rawY, transform.k);

        setTimeout(function () { showOffcanvas(lat, lon, true); }, 1000);

    });

    // ── Marker helper ─────────────────────────────────────────────────────

    function placeMarker(x, y, scale) {
        g.selectAll(".marker").remove();
        g.append("circle")
            .attr("cx",    x)
            .attr("cy",    y)
            .attr("r",     MARKER_RADIUS_PX / scale)
            .attr("class", "marker");
    }

    // ── Offcanvas bootstrap instance ──────────────────────────────────────

    var canvas = new bootstrap.Offcanvas("#offcanvas");

    // ── Open panel and initialise state ───────────────────────────────────

    function showOffcanvas(lat, lon, restoreInputs) {

        currentLat = lat;
        currentLon = lon;

        jQuery("#offcanvas_form")[0].reset();

        jQuery("#offcanvas")
            .find(".is-invalid, .is-valid")
            .removeClass("is-invalid is-valid")
            .removeAttr("aria-invalid");

        progressbar.init();

        jQuery("#offcanvas").find(".result").empty();

        jQuery("#results-area").addClass("hddn");

        // Populate coordinate inputs
        jQuery("#lolat").val(lat.toFixed(5));
        jQuery("#lolon").val(lon.toFixed(5));

        restoreApiKey("ninj");
        restoreApiKey("ieso");

        // Restore non-location inputs from last session if requested
        if (restoreInputs) {
            try {
                var raw = localStorage.getItem(SESSION_KEY);
                if (raw) {
                    var stored = JSON.parse(raw);
                    if (stored && stored.input) {
                        populateForm(stored.input);
                        // New location overrides whatever was stored
                        jQuery("#lolat").val(lat.toFixed(5));
                        jQuery("#lolon").val(lon.toFixed(5));
                    }
                }
            } catch (e) {}
        }

        jQuery("#offcanvas").find(".repr_week")
            .data("plot", "").data("vmin", "").data("vmax", "");

        areaChart.clear();

        jQuery("#offcanvas").find(".scrollable").scrollTop(0);

        canvas.show();

    }

    // ── Restore a full session from a parsed object ────────────────────────

    function restoreSession(session) {

        var inp = session.input;

        // Place marker at stored location
        var coords = projection([inp.lolon, inp.lolat]);
        if (coords) placeMarker(coords[0], coords[1], 1);

        // Open panel (resets form first), then repopulate
        showOffcanvas(inp.lolat, inp.lolon);
        populateForm(inp);

        // Re-render results if available
        if (session.output) {
            server_data = session.output;
            data_toUI(null, session.output);
        }

    }

    // ── Populate every form field from a stored input object ──────────────

    function populateForm(inp) {

        function set(id, val) {
            if (val != null) jQuery("#" + id).val(val);
        }

        set("lolat", inp.lolat);
        set("lolon", inp.lolon);

        set("iCapa_solr",        inp.iCapa_solr);
        set("cCost_solr",        inp.cCost_solr);
        set("oCost_t_cCost_solr", inp.oCost_t_cCost_solr);
        jQuery("#fOpts_solr").prop("checked", inp.fOpts_solr === 1);

        set("iCapa_wind",        inp.iCapa_wind);
        set("cCost_wind",        inp.cCost_wind);
        set("oCost_t_cCost_wind", inp.oCost_t_cCost_wind);
        jQuery("#fOpts_wind").prop("checked", inp.fOpts_wind === 1);

        set("iCapa_bess",        inp.iCapa_bess);
        set("cCost_bess",        inp.cCost_bess);
        set("oCost_t_cCost_bess", inp.oCost_t_cCost_bess);
        jQuery("#fOpts_bess").prop("checked", inp.fOpts_bess === 1);
        set("shBOS_bess", inp.shBOS_bess);
        set("hStrg_bess", inp.hStrg_bess);
        set("rtEff_bess", inp.rtEff_bess);

        set("cDura",     inp.cDura);
        set("oDura",     inp.oDura);
        set("kCost",     inp.kCost);
        set("rTarg",     inp.rTarg);
        set("case_desc", inp.case_desc);

    }

    // ── Build and persist session to localStorage ─────────────────────────

    function saveSession() {

        var session = {
            input: {
                lolat: currentLat,
                lolon: currentLon,
                iCapa_solr:         num("iCapa_solr"),
                cCost_solr:         num("cCost_solr"),
                oCost_t_cCost_solr: num("oCost_t_cCost_solr"),
                fOpts_solr:         bool("fOpts_solr"),
                iCapa_wind:         num("iCapa_wind"),
                cCost_wind:         num("cCost_wind"),
                oCost_t_cCost_wind: num("oCost_t_cCost_wind"),
                fOpts_wind:         bool("fOpts_wind"),
                iCapa_bess:         num("iCapa_bess"),
                cCost_bess:         num("cCost_bess"),
                oCost_t_cCost_bess: num("oCost_t_cCost_bess"),
                fOpts_bess:         bool("fOpts_bess"),
                shBOS_bess:         num("shBOS_bess"),
                hStrg_bess:         num("hStrg_bess"),
                rtEff_bess:         num("rtEff_bess"),
                cDura:  num("cDura"),
                oDura:  num("oDura"),
                kCost:  num("kCost"),
                rTarg:     num("rTarg"),
                case_desc: txt("case_desc")
            },
            output: server_data
        };

        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (e) {
            console.warn("Session save failed:", e);
        }

    }

    // ── Remove marker when panel is closed ────────────────────────────────

    jQuery("#offcanvas").on("hidden.bs.offcanvas", function () {
        setTimeout(function () { g.selectAll(".marker").remove(); }, 1000);
    });

    // ── Resize SVG on window resize ───────────────────────────────────────

    window.addEventListener("resize", function () {
        container.select("svg")
            .attr("width",  window.innerWidth)
            .attr("height", window.innerHeight);
    });

    // ── API key persistence ───────────────────────────────────────────────

    function saveApiKey(id) {
        var v = jQuery("#" + id).val().trim();
        if (v !== "") localStorage.setItem(id, v);
    }

    function restoreApiKey(id) {
        var v = localStorage.getItem(id);
        if (v !== null) jQuery("#" + id).val(v);
    }

    // ── Form validation ───────────────────────────────────────────────────

    window.valid_form = function () {

        var isValid = true;

        jQuery("#offcanvas_form input[data-expected]").each(function () {

            var $input     = jQuery(this),
                raw        = $input.val().trim(),
                type       = $input.data("expected"),
                fieldValid = true;

            $input.removeClass("is-invalid is-valid");

            if (type === "text") {

                if (raw === "") fieldValid = false;

            } else {

                var value = Number(raw),
                    min   = $input.data("mini"),
                    max   = $input.data("maxi");

                if (raw === "" || Number.isNaN(value))                fieldValid = false;
                if (fieldValid && type === "integer" && !Number.isInteger(value)) fieldValid = false;
                if (fieldValid && Number.isFinite(min) && value < min) fieldValid = false;
                if (fieldValid && Number.isFinite(max) && value > max) fieldValid = false;

            }

            if (!fieldValid) {
                $input.addClass("is-invalid");
                isValid = false;
            } else {
                $input.addClass("is-valid");
            }

        });

        return isValid;

    };

    // Clear validation decorations while typing
    jQuery("#offcanvas_form").on("input", "input", function () {
        jQuery(this).removeClass("is-invalid is-valid");
    });

    // ── Value helpers ─────────────────────────────────────────────────────

    function num(id)  { return Number(jQuery("#" + id).val()); }
    function bool(id) { return jQuery("#" + id).is(":checked") ? 1 : 0; }
    function txt(id)  { return jQuery("#" + id).val().trim(); }
    function fmt(v, d){ return (typeof v === "number") ? v.toFixed(d) : ""; }

    // ── Populate UI from server response ──────────────────────────────────

    function data_toUI(payload, data) {

        if (!data) return;

        jQuery("#results-area").removeClass("hddn");

        jQuery("#offcanvas").find(".demand").html(fmt(data.demand, 0));

        jQuery("#offcanvas").find(".firm_solr").html(fmt(data.firm_solr, 2));
        jQuery("#offcanvas").find(".firm_wind").html(fmt(data.firm_wind, 2));
        jQuery("#offcanvas").find(".firm_bess").html(fmt(data.firm_bess, 2));

        jQuery("#offcanvas").find(".cost").html(fmt(data.cost, 2));
        jQuery("#offcanvas").find(".cost_lcoe").html(fmt(data.cost_lcoe, 2));
        jQuery("#offcanvas").find(".cost_firm").html(fmt(data.cost_firm, 2));

        jQuery("#offcanvas").find(".cost_firm_solr").html(fmt(data.cost_firm_solr, 2));
        jQuery("#offcanvas").find(".cost_firm_wind").html(fmt(data.cost_firm_wind, 2));
        jQuery("#offcanvas").find(".cost_firm_bess").html(fmt(data.cost_firm_bess, 2));

        var vmax = data.inst_solr + data.firm_solr + data.inst_wind + data.firm_wind,
            vmin = -vmax;

        areaChart.plot(data.unit_commitment.uc_4380, vmin, vmax);

        jQuery(".uc_0")   .data({ plot: data.unit_commitment.uc_0,    vmin: vmin, vmax: vmax });
        jQuery(".uc_2190").data({ plot: data.unit_commitment.uc_2190,  vmin: vmin, vmax: vmax });
        jQuery(".uc_4380").data({ plot: data.unit_commitment.uc_4380,  vmin: vmin, vmax: vmax });
        jQuery(".uc_6570").data({ plot: data.unit_commitment.uc_6570,  vmin: vmin, vmax: vmax });

    }

    // ── Lat/lon inputs → update marker ────────────────────────────────────

    jQuery("#lolat, #lolon").on("change", function () {

        var lat = parseFloat(jQuery("#lolat").val());
        var lon = parseFloat(jQuery("#lolon").val());

        if (isNaN(lat) || isNaN(lon))               return;
        if (lat < -90  || lat > 90)                 return;
        if (lon < -180 || lon > 180)                return;

        currentLat = lat;
        currentLon = lon;

        var transform = d3.zoomTransform(svg.node());
        var coords    = projection([lon, lat]);
        if (coords) placeMarker(coords[0], coords[1], transform.k);

    });

    // ── Pick location on map button ───────────────────────────────────────

    jQuery("#pick-up-location").on("click", function () {
        canvas.hide();
    });

    // ── Simulate button ───────────────────────────────────────────────────

    jQuery("#simulate").on("click", function () {

        // Sync currentLat/Lon from inputs before validation
        var latVal = parseFloat(jQuery("#lolat").val());
        var lonVal = parseFloat(jQuery("#lolon").val());
        if (!isNaN(latVal)) currentLat = latVal;
        if (!isNaN(lonVal)) currentLon = lonVal;

        if (!valid_form()) {
            var $err = jQuery(".is-invalid").first();
            if ($err.length) $err[0].scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }

        saveApiKey("ninj");
        saveApiKey("ieso");

        var payload = {
            apik: {
                ieso: txt("ieso"),
                ninj: txt("ninj")
            },
            site: {
                lolat: currentLat,
                lolon: currentLon,
                cDura: num("cDura"),
                oDura: num("oDura"),
                kCost: num("kCost"),
                rTarg: num("rTarg")
            },
            solr: {
                iCapa:        num("iCapa_solr"),
                cCost:        num("cCost_solr"),
                oCost_t_cCost: num("oCost_t_cCost_solr"),
                fOpts:        bool("fOpts_solr")
            },
            wind: {
                iCapa:        num("iCapa_wind"),
                cCost:        num("cCost_wind"),
                oCost_t_cCost: num("oCost_t_cCost_wind"),
                fOpts:        bool("fOpts_wind")
            },
            bess: {
                iCapa:        num("iCapa_bess"),
                hStrg:        num("hStrg_bess"),
                rtEff:        num("rtEff_bess"),
                shBOS:        num("shBOS_bess"),
                cCost:        num("cCost_bess"),
                oCost_t_cCost: num("oCost_t_cCost_bess"),
                fOpts:        bool("fOpts_bess")
            }
        };

        progressbar.busy();

        jQuery.ajax({

            url:         "https://responsive.li/api/firm-lcoe-calculator/",
            method:      "POST",
            data:        JSON.stringify(payload),
            contentType: "application/json",
            dataType:    "json",
            timeout:     900000,

            success: function (response) {

                if (!response || typeof response.rs === "undefined") {
                    msgbox.failure("Invalid server response");
                    return;
                }

                if (response.rs === 1) {

                    server_data = response.data;
                    data_toUI(payload, response.data);
                    saveSession();
                    msgbox.success("Simulation completed successfully");
                    console.log(response.tx);

                } else {

                    msgbox.failure("Simulation failed");
                    console.log(response.tx);

                }

            },

            error: function (xhr) {

                var tx = "Request failed. Are you connected?";
                if (xhr && xhr.responseText) {
                    try {
                        var resp = JSON.parse(xhr.responseText);
                        if (resp && resp.tx) tx = resp.tx;
                    } catch (e) { /* ignore */ }
                }
                msgbox.failure(tx);

            },

            complete: function () {
                progressbar.init();
            }

        });

    });

    // ── Generate share link ───────────────────────────────────────────────

    jQuery("#btn-generate").on("click", function () {

        if (!server_data || !server_data.demand) {
            msgbox.info("Run a simulation first before generating a share link.");
            return;
        }

        var payload = {
            input: {
                lolat:              currentLat,
                lolon:              currentLon,
                case_desc:          txt("case_desc"),
                iCapa_solr:         num("iCapa_solr"),
                cCost_solr:         num("cCost_solr"),
                oCost_t_cCost_solr: num("oCost_t_cCost_solr"),
                fOpts_solr:         bool("fOpts_solr"),
                iCapa_wind:         num("iCapa_wind"),
                cCost_wind:         num("cCost_wind"),
                oCost_t_cCost_wind: num("oCost_t_cCost_wind"),
                fOpts_wind:         bool("fOpts_wind"),
                iCapa_bess:         num("iCapa_bess"),
                cCost_bess:         num("cCost_bess"),
                oCost_t_cCost_bess: num("oCost_t_cCost_bess"),
                fOpts_bess:         bool("fOpts_bess"),
                shBOS_bess:         num("shBOS_bess"),
                hStrg_bess:         num("hStrg_bess"),
                rtEff_bess:         num("rtEff_bess"),
                cDura:              num("cDura"),
                oDura:              num("oDura"),
                kCost:              num("kCost"),
                rTarg:              num("rTarg")
            },
            output: server_data
        };

        jQuery.ajax({
            url:         "https://responsive.li/api/firm-lcoe-calculator/save/",
            method:      "POST",
            data:        JSON.stringify(payload),
            contentType: "application/json",
            dataType:    "json",
            success: function (resp) {
                if (resp.rs === 1) {
                    var base = window.location.href.split("?")[0];
                    jQuery("#share-url").val(base + "?share=" + resp.id);
                    jQuery("#btn-copy").prop("disabled", false);
                } else {
                    msgbox.failure("Could not generate share link.");
                }
            },
            error: function () {
                msgbox.failure("Could not generate share link.");
            }
        });

    });

    // ── Copy share link ───────────────────────────────────────────────────

    jQuery("#btn-copy").on("click", function () {
        var url = jQuery("#share-url").val();
        if (!url) return;
        navigator.clipboard.writeText(url).then(function () {
            var $icon = jQuery("#btn-copy").find("i");
            $icon.removeClass("bi-clipboard").addClass("bi-check2");
            setTimeout(function () {
                $icon.removeClass("bi-check2").addClass("bi-clipboard");
            }, 2000);
        });
    });

    // ── Week-selector links ───────────────────────────────────────────────

    jQuery(".repr_week").on("change", function () {
        var plot = jQuery(this).data("plot");
        var vmin = jQuery(this).data("vmin");
        var vmax = jQuery(this).data("vmax");
        if (!plot) return;
        areaChart.plot(plot, vmin, vmax);
    });

});
