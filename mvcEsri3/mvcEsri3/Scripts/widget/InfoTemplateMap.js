define([
    "dojo/_base/declare",
    "dijit/_Widget",
    "dijit/_TemplatedMixin",
    "dijit/_WidgetsInTemplateMixin",
    "dojo/text!./templates/InfoTemplateMap.html",
    "esri/tasks/IdentifyTask", "esri/tasks/IdentifyParameters",
    "esri/tasks/FindTask", "esri/tasks/FindParameters", "esri/tasks/QueryTask", "esri/tasks/query",
    "esri/graphicsUtils",
    "dojo/_base/array", "dojo/DeferredList", "dojo/date/locale",
    "dijit/registry", "dojo/on", "dojo/dom", "dojo/dom-attr", "dojo/dom-class", "dojo/query",
    "dojo/dom-construct"
], function (
    declare,
    _Widget,
    _TemplatedMixin,
    _WidgetsInTemplateMixin,
    template, IdentifyTask, IdentifyParameters, FindTask, FindParameters, QueryTask, QueryParamenter,
    graphicsUtils,
    array, DeferredList, locale, registry, on, dom, domAttr, domClass, query,
    domConstruct
) {
    return declare([_Widget, _TemplatedMixin, _WidgetsInTemplateMixin], {
        templateString: template,
        map: null,
        setGeometry: null,
        objInfo: [],
        constructor: function () {
            //this.map = map;
        },
        postCreate: function () {
            var that = this;
            // on(map, "click", function (evt) { that._buscarInformacoesServico(evt.mapPoint); });
            on(that.listaTemplates, "change", function (evt) { that._onSelectedTemplate(evt); });
            that.listaTemplates.style.display = "none";
            that.setGeometry = that._buscarInformacoesServico;
        },
        _onPageClick: function (event, page, that, div) {
            var nl = query(".itemTemplateShow", div);
            var pg = dom.byId("list" + div + page);
            if (nl.length > 0 && that.listaTemplates.value) {
                domClass.remove(nl[0], "itemTemplateShow");
            }
            if (pg !== undefined && pg !== null) {
                domClass.add(pg, "itemTemplateShow");
            }
            that._onSelectedTemplate(true);
        },
        _onSelectedTemplate: function (event) {
            var nl = query(".divTemplateShow", this.listaDivs);
            nl.filter(function (option) {
                domClass.remove(option, "divTemplateShow");
            });
            domClass.add(dom.byId(this.listaTemplates.value), "divTemplateShow");
            if (query(".divTemplateShow", this.listaDivs).length > 0) {
                var div = query(".itemTemplateShow", dom.byId(this.listaTemplates.value))[0];
                if (event.target !== undefined) { event = false; }
                this._zoomSelectedPara(this.listaTemplates.value, div.attributes.rel.value, event);
            }
            this.listaTemplates.style.display = "block";
        },
        _zoomPara: function (evt) {
            if (query(".divTemplateShow", this.listaDivs).length > 0) {
                var div = query(".itemTemplateShow", dom.byId(this.listaTemplates.value))[0];
                this._zoomSelectedPara(this.listaTemplates.value, div.attributes.rel.value, true);
            }
        },
        _buscarInformacoesServico: function (geometry) {
            var that = this;
            var layerFields = [];
            that._limparObjetos();
            //TODO: Estudar os parametros                    
            var layers = dojo.map(that.map.layerIds, function (layerId) {
                return that.map.getLayer(layerId);
            }); //Create an array of all layers in the map
            layers = dojo.filter(layers, function (layer) {
                //verifica as layers visiveis com o id maior que -1
                var list = layer.visibleLayers.filter(function (layerInfo) { return layerInfo > -1; });
                return list.length > 0 && layer.getImageUrl && layer.visible;
            }); //Only dynamic layers have the getImageUrl function. Filter so you only query visible dynamic layers
            var tasks = dojo.map(layers, function (layer) {
                //var ids = layer.layerInfos.filter(function (layerInfo) {
                //    return layer.visibleLayers.filter(function (id) { return ((layerInfo.visible || layerInfo.defaultVisibility) && layerInfo.id === id && layerInfo.subLayerIds === null) });
                //}).map(function (layerInfo) { return layerInfo.id });
                var ids = layer.visibleLayers;

                //chama a função que pesquisa os filds da layer
                if (ids.length > 0) {
                    dojo.map(ids, function (id) {
                        $.ajax({
                            type: "POST",
                            url: layer.url + id,
                            data: { f: "json" },
                            dataType: "jsonp",
                            async: false,
                            callbackParamName: "callback"
                        }).then(function (resp) { layerFields.push({ layer: resp, service: layer }); });
                    });
                }
                return ((ids.length > 0 && layer.visible) && { tasks: new esri.tasks.IdentifyTask(layer.url), ids: ids });
            }); //map each visible dynamic layer to a new identify task, using the layer url
            var tasks = tasks.filter(function (obj) {
                return obj !== false;
            });
            var defTasks = dojo.map(tasks, function (task) {
                return new dojo.Deferred();
            }); //map each identify task to a new dojo.Deferred
            var dlTasks = new dojo.DeferredList(defTasks); //And use all of these Deferreds in a DeferredList

            dlTasks.then(function (r) { that._showResults(r, that, layerFields); }); //chain showResults onto your DeferredList
            //Parametros de identificação
            var identifyParams = new IdentifyParameters();
            identifyParams.tolerance = 3;
            identifyParams.returnGeometry = true;
            identifyParams.layerOption = IdentifyParameters.LAYER_OPTION_VISIBLE;
            identifyParams.width = that.map.width;
            identifyParams.height = that.map.height;
            identifyParams.geometry = geometry;
            identifyParams.mapExtent = that.map.extent;
            for (i = 0; i < tasks.length; i++) { //Use 'for' instead of 'for...in' so you can sync tasks with defTasks
                try {
                    identifyParams.layerIds = tasks[i].ids;//passa para o identifyparams os ids das layers visiveis (ativadas)
                    if (tasks[i].ids.length > 0) {
                        tasks[i].tasks.execute(identifyParams, defTasks[i].callback, defTasks[i].errback); //Execute each task                                  
                    }
                } catch (e) {
                    that.map.setMapCursor('default');
                    defTasks[i].errback(e); //If you get an error for any task, execute the errback
                }
            }
            //altera o ponteiro do mouse.
            that.map.setMapCursor('wait');
        },
        
        _showResults: function (r, that, resultFields) {
            
            var results = [], listLayerNames = [];
            r = dojo.filter(r, function (result) {
                return r[0];
            }); //filter out any failed tasks
            for (i = 0; i < r.length; i++) {
                results = results.concat(r[i][1]);
            }
            // limpa a lista de divs
            that._limparObjetos();
            //cria a lista de templates
            listLayerNames = that._criarDivTemplates(results, that);
            that.listaTemplates.style.display = "none";

            dojo.map(results, function (result) {
                var feature = result.feature;
                //   var fields = Object.keys(feature.attributes);
                for (var i = 0; i < resultFields.length; i++) {
                    if (resultFields[i].layer.id === result.layerId && resultFields[i].layer.name === result.layerName) {
                        var fields = resultFields[i].layer.fields;
                        var div = dom.byId(result.layerName.replace(/\s/g, ""));
                        var count = div.childNodes.length + 1;

                        var field = fields.filter(function (field) { return (field && field.type === "esriFieldTypeOID") });
                        var valor = feature.attributes[field[0].alias];
                        var nodeDiv = domConstruct.toDom("<div rel=" + valor + " class=\"itemTemplateHide\" id=\"list" + (result.layerName.replace(/\s/g, "") + count) + "\" style=\"border:1px solid; height:300px; width:400px;overflow:auto;\">Page " + count + "<br/>" + that._montarTemplate(feature, fields) + "</div>");
                        domConstruct.place(nodeDiv, div, "last");

                        dojo.map(that.objInfo, function (obj) {
                            var name = result.layerName.replace(/\s/g, "");
                            if (obj[name] !== undefined) {
                                obj[name].totalpages = count;
                                obj[name].url = resultFields[i].service.url;
                                obj[name].idLayer = resultFields[i].layer.id;
                                obj[name].objID = field[0].name;
                            }
                        });
                    }
                }
            });
            that.map.setMapCursor('default');
            that._criarDivPaginador(listLayerNames, that);
            that._criarPaginador(listLayerNames, that);
        },
        _montarTemplate: function (graphic, fields) {
            var that = this;
            var text = "";
            var attributes = graphic.attributes;

            for (var i = 0; i < fields.length; i++) {
                if (fields[i].type === "esriFieldTypeDate") {
                    text += "<b>" + fields[i].alias.replace(/_/g, " ").toUpperCase() + "</b> : " + that._formatarData(attributes[fields[i].alias]) + "<br/>";
                } else if (attributes[fields[i].alias] === null || attributes[fields[i].alias] === "") {
                    text += "<b>" + fields[i].alias.replace(/_/g, " ").toUpperCase() + "</b> : <br/>";
                } else if (fields[i].type === "esriFieldTypeString") {
                    text += "<b>" + fields[i].alias.replace(/_/g, " ").toUpperCase() + "</b> : " + (attributes[fields[i].alias] !== undefined ? attributes[fields[i].alias].toUpperCase() : '') + "<br/>";
                } else {
                    if (attributes[fields[i].alias] === false) {
                        text += "<b>" + fields[i].alias.replace(/_/g, " ").toUpperCase() + "</b> : Não <br/>";
                    } else if (attributes[fields[i].alias] === true) {
                        text += "<b>" + fields[i].alias.replace(/_/g, " ").toUpperCase() + "</b> : Sim <br/>";

                    } else {
                        text += "<b>" + fields[i].alias.replace(/_/g, " ").toUpperCase() + "</b> : " + attributes[fields[i].alias] + "<br/>";
                    }
                }
            }
            return text;
        },
        _criarDivTemplates: function (results, that) {
            //lista de layer names
            var listLayerNames = dojo.map(results, function (result) { return result.layerName; });
            listLayerNames = that._cleanFilterObjects(listLayerNames);
            console.log(listLayerNames);
            dojo.map(listLayerNames, function (result) {
                //carrega objects
                that.objInfo.push({ [result.replace(/\s/g, "")]: { layer: result } });
                var nodeDiv = domConstruct.toDom("<div class=\"divTemplateHide\" data-dojo-attach-point=" + result.replace(/\s/g, "") + " id=" + result.replace(/\s/g, "") + "></div>");
                domConstruct.place(nodeDiv, that.listaDivs);

                var nodeOption = domConstruct.toDom("<option value=" + result.replace(/\s/g, "") + ">" + result + "</div>");
                domConstruct.place(nodeOption, that.listaTemplates, "last");

            });
            return listLayerNames;
        },
        _criarDivPaginador: function (listLayerNames, that) {
            dojo.map(listLayerNames, function (n) {
                var nome = n.replace(/\s/g, "");
                
                var nodeZoom = domConstruct.toDom("<button type=\"button\" class=\"btn btn-info btn-lg\" id=\"zoom" + nome + "\" data-dojo-attach-point=\"zoom" + nome + "\" data-dojo-attach-event=\"click: _zoomPara\">zoom para</button>");
                domConstruct.place(nodeZoom, dom.byId(nome), "last");
                var nodePginador = domConstruct.toDom("<ul id=\"pagination" + nome + "\" class=\"pagination-sm\"></ul>");
                domConstruct.place(nodePginador, dom.byId(nome), "last");
                on(nodeZoom, "click", function (evt) { that._zoomPara(evt); });
            });
        },
        _criarPaginador: function (listLayerNames, that) {
            dojo.map(listLayerNames, function (n) {
                var nome = n.replace(/\s/g, "");
                dojo.map(that.objInfo, function (result) {
                    if (result[nome] !== undefined) {
                        var div = dom.byId(nome);
                        var count = div.childNodes.length - 2;
                        var visiblepages = count, totalpages = count;
                        if (totalpages > 5) { visiblepages = 5; }
                        var id = "#pagination" + nome;
                        //  setTimeout(function () {
                        $(id).twbsPagination({
                            totalPages: totalpages,
                            visiblePages: visiblepages,
                            first: "Inicio",
                            prev: "Anterior",
                            next: "Próximo",
                            last: "Último",
                            onPageClick: function (event, page) {
                                that._onPageClick(event, page, that, nome);
                            }
                        });
                        //  }, 1000);
                    }
                });
            });
        },
        _formatarData: function (value) {
            var inputDate = new Date(value);
            inputDate.setDate((inputDate.getDate() + 1));
            return locale.format(inputDate, {
                selector: 'date',
                datePattern: 'dd/MM/y'
            });
        },
        _cleanFilterObjects: function (values) {
            var unique = {};
            return dojo.filter(values, function (value) {
                if (!unique[value]) {
                    unique[value] = true;
                    return true;
                }
                return false;

            }).sort();
        },
        _limparObjetos: function () {
            domConstruct.empty("listaDivs");
            domConstruct.empty("listaTemplates");
            this.objInfo = [];
        },
        _zoomSelectedPara: function (chave, value, zoom) {           
            // função zoom recebe o valor da chave object, value e bool zoom.
            var that = this;
            dojo.map(that.objInfo, function (obj) {
                var name = chave;
                if (obj[name] !== undefined) {                 
                    var findTask = new FindTask(obj[name].url);
                    var findParams = new FindParameters();
                    findParams.returnGeometry = true;
                    findParams.outSpatialReference = that.map.spatialReference;
                    findParams.layerIds = [obj[name].idLayer];
                    findParams.searchFields = [obj[name].objID, "FID"];
                    findParams.searchText = value;
                    findParams.contains = false;
                    var deferred = findTask.execute(findParams);

                    deferred.addCallback(function (response) {
                        var features = dojo.map(response, function (result) {
                            var feature = result.feature;
                            feature.attributes.layerName = result.layerName;
                            feature.geometry.spatialReference = that.map.spatialReference;
                            return feature;
                        });
                        if (zoom) {
                            if (features[0].geometry.type === "point") {
                                that.map.centerAndZoom(features[0].geometry, 12);
                            } else {
                                var extent = graphicsUtils.graphicsExtent(features);
                                that.map.setExtent(extent.expand(1.25), true);
                            }
                        }
                        return features;
                    });
                    that.map.infoWindow.setFeatures([deferred]);
                }
            });
        }
    });
});