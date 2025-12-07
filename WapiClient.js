class WapiClient {
    
    static API_PATH = '/w/api.php';
    wapiPort = null;

    /**
     * @param {string} baseURL Wiki istance domain (es: 'https://www.wikidata.org' o 'https://my.wikibase.site').
     * @param {string} lang Default language (es: 'en', 'it').
     */
    constructor(baseURL = 'https://www.wikidata.org', lang = 'en', port = null) {

        this.baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
        this.lang = lang;
        this.apiURL = this.baseURL + WikiClient.API_PATH;

        if (this.baseURL.includes("wikidata.org") || this.baseURL.includes("query.wikidata.org")) {
            this.sparqlEndpoint = 'https://query.wikidata.org/sparql';
        } else {
            this.sparqlEndpoint = `${this.baseURL}/query/sparql`;
        }

        this.token = null;
        this.wapiPort = port;

    
    }

    /**
     * @private
     * Send request to WAPI browser-extension
     * @returns {Promise<{json: () => Promise<Object>}>}
     */
    async #wapiFetch(url, method = 'GET', headers = {}, body = null) {
        
        if (this.wapiPort) {
            return this.#popupFetch(url, method, headers, body); // Browser Extension
        } else {
            return this.#windowFetch(url, method, headers, body); // Web page
        }
    };

    /**
     * @private
     * Communication via native API (Popup, SidePanel, ecc.)
     */
    async #popupFetch(url, method, headers, body) {
        
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: "proxy-api",
                url: url,
                method: method,
                headers: headers,
                body: body
            }, (response) => {

                if (chrome.runtime.lastError) {
                    return reject(new Error("Runtime error: " + chrome.runtime.lastError.message));
                }

                if (response.success) {
                    resolve({ 
                        ok: true, 
                        json: () => Promise.resolve(response.data) 
                    });
                } else {
                    reject(new Error(response.error || 'Unknown error from WAPI.'));
                }
            });
        });
    }

    /**
     * @private
     * Communication via window.postMessage (Content Script).
     */
    async #windowFetch(url, method, headers, body) {

        return new Promise((resolve, reject) => {
            const requestId = new Date().getTime(); 

            const responseHandler = (event) => {
                if (event.origin !== window.origin || !event.data || event.data.requestId !== requestId) return;
                
                if (event.data.action !== 'api-response') return; 

                window.removeEventListener('message', responseHandler);

                if (event.data.success) {
                    resolve({ ok: true, json: () => Promise.resolve(event.data.data) });
                } else {
                    reject(new Error(event.data.error || 'Unknown error from WAPI.'));
                }
            };

            window.addEventListener('message', responseHandler);

            window.postMessage({
                action: 'request-api',
                url: url,
                requestId: requestId,
                method: method,
                headers: headers,
                body: body
            }, window.origin);
        });
    }

    /**
     * @private
     * Generic query to API.
     * @param {Object} params API URL params
     * @returns {Promise<Object>} JSON Object.
     */
    async #query(params) {

        const defaultParams = {
            origin: '*',
            format: 'json',
            formatversion: 2,
            ...params
        };

        const url = new URL(this.apiURL);
        url.search = new URLSearchParams(defaultParams).toString();

        try {
            const response = await this.#wapiFetch(
                url.toString(),
                'GET',
                {'Accept': 'application/json'}
            )
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Errore durante l'interazione con l'API di ${this.baseURL}:`, error);
            throw error;
        }
    }


    /**
    * SPARQL Query request
    * @param {string} query - Query SPARQL
    * @returns {Array<Object>|[]}
    */
    async #sparql(sparql_query) {

        const params = {
            query: sparql_query
        };
        const url = `${this.sparqlEndpoint}?${params.toString()}`;
        const response = await this.#wapiFetch( 
            url, 
            'GET',
            { 'Accept': 'application/sparql-results+json' },
            null
        );
        const data = await response.json();
        return data

    }

    /**
    * POST request for edit
    * @param {Object} params - API URL params
    * @returns {bool} 
    */
    async #edit(params) {
        
        const defaultParams = {
            token: this.token,
            ...params
        }

        const url = new URL(this.apiURL);

        const response = await this.#wapiFetch(
            url, 
            'POST', 
            {},
            new URLSearchParams(defaultParams).toString()
        )
        const data = await response.json()
        return data;
    }

    // USER INFO
    
    /**
     * Get CSRF token from browser for editing.
     * @returns {Promise<string>} Token CSRF
     */
    async getAuthToken() {
        const params = {
            action: "query",
            meta: "tokens",
        };
        const data = await this.#query(params);
        
        const raw_token = data.query.tokens.csrftoken

        const token = raw_token == "+\\" ? null : raw_token

        if (!token) {
            throw new Error("CSRF not found. Session not authenticated");
        }
        this.token = token;

        return token

    }

    /**
    * Get user information
    * @returns {Object|null}
    */
    async getUserInfo() {
        const params = {
            action: "query",
            meta: "userinfo"
        };
        const data = await this.#query(params);
        
        if (data.query?.userinfo) {
            return data.query.userinfo
        } else {
            return null
        }
    } 


    // QUERY

    /**
     * public SPARQL request method.
     * @param {string} itemId - QID
     * @returns {Promise<Array>} Objects array
     */
    async querySparql(query) {
        const json = await this.#sparql(query);
        const data = json.results?.bindings || [];
        return data

    }

    /**
    * Get Item details
    * @param {string} itemId - QID
    * @returns {Object|null}
    */
    async getItem(itemId, props = 'labels|descriptions|claims') {

        const params = {
            action: 'wbgetentities',
            ids: itemId,
            props: props,
            languages: this.lang
        };

        const data = await this.#query(params);
        return data.entities[itemId] || null;

    }

    /**
     * Get specific claim value
     * * @param {string} itemId - QID
     * @param {string} propertyId - Property ID (es: "P27").
     * @returns {Promise<Array<Object>|[]>}
     */
    async getClaimValue(itemId, propertyId) {

        const params = {
            action: 'wbgetentities',
            ids: itemId,
            props: 'claims',
            languages: this.lang
        };

        const data = await this.#query(params);
        
        const entity = data.entities[itemId];
        if (!entity || entity.missing) {
            console.warn(`Claim not found: ${itemId}`);
            return [];
        }

        const claims = entity.claims[propertyId];
        if (!claims) {
            return [];
        }

        const values = claims
            .filter(claim => claim.mainsnak && claim.mainsnak.snaktype === 'value')
            .map(claim => claim.mainsnak.datavalue);

        return values;
    }

    /**
     * Get sitelink (link to Wikipedia, ecc.)
     * @param {string} entityId - QID
     * @returns {Promise<Object|null>} Mapped obj (es: { itwiki: {...} }).
     */
    async getSitelinks(entityId) {
        const params = {
            action: 'wbgetentities',
            ids: entityId,
            props: 'sitelinks'
        };

        const data = await this.#query(params);
        const entity = data.entities[entityId];
        
        if (!entity || entity.missing) {
            return null;
        }

        return entity.sitelinks || null;
    }

    /**
    * Get matches with items using label
    * @param {string} label - label to search
    * @param {number} limit - Results limit
    * @returns {Array<{id: string, label: string, description: string, uri: string>}|[]} - Ritorna un array di oggetti 
    */
    async searchEntitiesByLabel(label, limit) {

        const params = {
            action: "wbsearchentities",
            search: label,
            language: this.lang,
            uselang: this.lang,
            type: "item",
            limit: limit
        };

        const json = await this.#query(params);

        if (json && json?.search) {
            const filterList = json.search.map((ent) => ({
                id: ent.id,
                label: ent.label,
                description: ent.description,
                uri: ent.concepturi
            }));
            return filterList
        } else {
            return []
        }
    }

    /**
    * Get matches with properties using label
    * @param {string} label - Label to search
    * @param {number} limit - Results limit
    * @returns {Array<{id: string, label: string, description: string, uri: string>}|[]}
    */
    async searchPropertiesByLabel(label, limit) {

        const params = {
            action: "wbsearchentities",
            search: label,
            language: this.lang,
            uselang: this.lang,
            type: "property",
            limit: limit
        };

        const json = await this.#query(params);

        if (json && json?.search) {
            const filterList = json.search.map((prop) => ({
                id: prop.id,
                label: prop.label,
                description: prop.description,
                uri: prop.concepturi
            }));
            return filterList
        } else {
            return []
        }

    }

    /**
    * Get properties related to give property
    * @param {string} label - Label to search
    * @returns {Array<{id: string, label: string, description: string, uri: string}|[]}
    */
    async getRelatedProperties(property, limit) {

        const query = `
        SELECT ?relatedProp ?relatedPropLabel ?relatedPropDescription 
        WHERE {
            {
                wd:${property.toUpperCase()} wdt:P1659 ?relatedProp .
            } UNION {
                ?relatedProp wdt:P1659 wd:${property.toUpperCase()} .
            }
            SERVICE wikibase:label {
                bd:serviceParam wikibase:language "[AUTO_LANGUAGE],it,en".
                ?relatedProp rdfs:label ?relatedPropLabel ;
                    schema:description ?relatedPropDescription .
            }
        }
        LIMIT ${limit}
        `;

        const json = await this.#sparql(query);

        if (json && json.results?.bindings) {
            const filterList = json.results?.bindings.map((prop) => ({
                id: prop.relatedProp.value.split("/").pop(),
                label: prop.relatedPropLabel?.value || "",
                description: prop.relatedPropDescription?.value || "",
                uri: prop.relatedProp.value
            }));
            return filterList
        } else {
            return []
        }
    }


    // EDIT

    /**
     * Set title, alias o description for an existing item
     * @param {string} itemId - QID
     * @param {string} type - 'label', 'description' or 'alias'.
     * @param {string} value - New value
     * @param {string} summary - Edit summary
     * @returns {Promise<Object>}
     */
    async setTitle(itemId, type, value, lang = this.lang, summary = "") {

        if (!this.token) {
            this.token = await this.getAuthToken()
        }
        if (!this.token) {
            throw new Error("Not logged");
        }

        const params = {
            action: 'wbsetlabel',
            id: itemId,
            [type]: value,
            language: lang,
            summary: summary
        };

        const response = await this.#edit(params);
        return response
    }

    /**
    * Set a claim for a specific item
    * @param {string} itemId - QID
    * @param {object} body - Request body (es. { claims: [] })
    * @param {string} summary - Edit summary
    * @returns {bool}
    */
    async setClaim(itemId, propertyId, value, dataType, summary) {

        if (!this.token) {
            this.token = await this.getAuthToken()
        }
        if (!this.token) {
            throw new Error("Not logged");
        }

        let datavalue;

        switch (dataType) {
            case 'wikibase-item':
            case 'wikibase-property':
                datavalue = {
                    "value": {
                        "entity-type": dataType.split('-')[1], // 'item' o 'property'
                        "id": value // Es: "Q145"
                    },
                    "type": "wikibase-entityid"
                };
                break;
            case 'string':
            case 'url':
            case 'external-id':
                datavalue = {
                    "value": value, // Es: "Douglas Adams"
                    "type": "string"
                };
                break;
            case 'time':
                datavalue = {
                    "value": {
                        "time": value, 
                        "timezone": 0,
                        "before": 0,
                        "after": 0,
                        "precision": 11, // Day
                        "calendarmodel": "http://www.wikidata.org/entity/Q1985727"
                    },
                    "type": "time"
                };
                break;
            // 'globe-coordinate', 'quantity', ...
            default:
                throw new Error(`Data type not supported: ${dataType}`);
        }

        const claimPayload = {
            "property": propertyId,
            "mainsnak": {
                "snaktype": "value",
                "property": propertyId,
                "datavalue": datavalue
            },
            "type": "statement"
        };

        const params = {
            action: 'wbsetclaim',
            claim: JSON.stringify(claimPayload),
            id: itemId,
            summary: summary,
            token: this.token
        };

        const data = await this.#edit(params)
        if (data.error) {
            throw new Error(`API Error (${data.error.code}): ${data.error.info}`);
        }
        return data;
    }

    /**
     * Remove a claim given claim-id (es: 'Q42$20F4C8C2-4C79-450F-87D9-4E65A548F065').
     * @param {string|Array<string>} claimIds - Claim IDs
     * @param {string} summary - Edit summary
     * @returns {Promise<Object>}
     */
    async removeClaim(claimIds, summary) {
        if (!this.token) {
            this.token = await this.getAuthToken()
        }
        if (!this.token) {
            throw new Error("Not logged");
        }
        
        const claims = Array.isArray(claimIds) ? claimIds.join('|') : claimIds;

        const params = {
            action: 'wbremoveclaims',
            claim: claims,
            summary: summary,
            token: this.token
        };

        const response = await this.#edit(params); 
        return response;
    }

    /**
    * Edit Item using custom body
    * @param {string} itemId - QID
    * @param {object} body - Request body (es. { claims: [] })
    * @param {string} summary - Edit summary
    * @returns {bool} 
    */
    async editEntity(itemId, body, summary = null) {

        if (!this.token) {
            this.token = await this.getAuthToken()
        }
        if (!this.token) {
            throw new Error("Not logged");
        }

        const params = {
            action: "wbeditentity",
            id: itemId,
            token: this.token,
            data: JSON.stringify(body),
            summary: summary
        };
        const response = await this.#wapiFetch(
            this.apiURL, 
            'POST', 
            {},
            params.toString()
        )
        if (response.success === 1) {
            return true
        } else {
            console.log(response)
            return false
        }
    }
    
}

export { WapiClient };

if (typeof window !== 'undefined') {
    window.WapiClient = WapiClient;
}

// CommonJS (Node.js)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WapiClient };
}