/*
 * apiClient.js — Low-level HTTP wrapper around fetch().
 *
 * Public API: window.JSQ_ApiClient
 *
 * Every REST call in authCache.js and queueCache.js goes through one
 * of the four functions below instead of calling fetch() directly.
 * That means:
 *   - `credentials: 'include'` (send the jsq_session cookie) only
 *     needs to be written once, here, not on every call site.
 *   - Server error responses ({ error: "..." }) get turned into a
 *     normal thrown Error with that same message, so calling code can
 *     just do `.catch(function (err) { showError(err.message); })`
 *     exactly like it already does with the old auth.js/queue.js.
 *
 * This file doesn't know anything about auth or queues specifically —
 * it's plumbing, the same way server/events.js is plumbing on the
 * backend.
 */
(function (window) {
    'use strict';

    async function handleResponse(res) {
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }

        if (!res.ok) {
            const message = (body && body.error) ? body.error : ('Request failed (' + res.status + ').');
            throw new Error(message);
        }
        return body;
    }

    function apiGet(path) {
        return fetch(path, { credentials: 'include' }).then(handleResponse);
    }

    function apiPost(path, data) {
        return fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
        }).then(handleResponse);
    }

    function apiPatch(path, data) {
        return fetch(path, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
        }).then(handleResponse);
    }

    function apiDelete(path) {
        return fetch(path, {
            method: 'DELETE',
            credentials: 'include'
        }).then(handleResponse);
    }

    window.JSQ_ApiClient = {
        get: apiGet,
        post: apiPost,
        patch: apiPatch,
        del: apiDelete
    };

})(window);
