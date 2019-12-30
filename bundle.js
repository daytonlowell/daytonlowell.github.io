(function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    var channelsData = [
    	{
    		'name': 'ABC',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'CBS',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Fox',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'NBC',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'PBS',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'CW',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'MyNetworkTV',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'A&E',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'ACC Network',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'AMC',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Animal Planet',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'BBC America',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'BBC World News',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'BET',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Big Ten Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Bloomberg TV',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Boomerang',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Bravo',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Cartoon Network',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'CBS Sports Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Cheddar',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Cinemax',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': 'add-on',
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'CMT',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'CNBC',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'CNN',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Comedy Central',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Cooking Channel',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Destination America',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Discovery Channel',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Disney Channel',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Disney Junior',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Disney XD',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'DIY',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'E!',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'EPIX',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': 'add-on',
    		},
    	},
    	{
    		'name': 'ESPN',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'ESPN 2',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'ESPNEWS',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'ESPNU',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Food Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Fox Business',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Fox News',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Fox Sports 1',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Fox Sports 2',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Freeform',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'FX',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'FX Movie Channel',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'FXX',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'FYI',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Golf Channel',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Hallmark',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'HBO',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': 'add-on',
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'HGTV',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'History',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'HLN',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'IFC',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Investigation Discovery',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Lifetime',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Lifetime Movie Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'MLB Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Motor Trend',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': false,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'MSNBC',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'MTV',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'MTV2',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'National Geographic',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Nat Geo Wild',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'NBA TV',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'NBC Sports Network',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Newsy',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'NFL Network',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'NFL RedZone',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'NHL Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Nickelodeon',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Nick Jr.',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Nicktoons',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'OWN',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Oxygen',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Paramount Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Science',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'SEC Network',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Showtime',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': 'add-on',
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': 'add-on',
    		},
    	},
    	{
    		'name': 'Smithsonian',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Starz',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': 'add-on',
    		},
    	},
    	{
    		'name': 'Sundance TV',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Syfy',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Tastemade',
    		'providers': {
    			'AT&T TV Now': false,
    			'AT&T Watch TV': false,
    			'Fubo TV': false,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'TBS',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'TCM',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Telemundo',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Tennis Channel',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': 'add-on',
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'TLC',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'TNT',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'Travel Channel',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'TruTV',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'TV Land',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Univision',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': false,
    			'Sling Blue': false,
    			'Sling Orange': false,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'USA Network',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': false,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': false,
    			'Sling Blue': true,
    			'Sling Orange': false,
    			'YouTube TV': true,
    		},
    	},
    	{
    		'name': 'VH1',
    		'providers': {
    			'AT&T TV Now': true,
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'Viceland',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': true,
    			'Philo': true,
    			'Sling Blue': true,
    			'Sling Orange': true,
    			'YouTube TV': false,
    		},
    	},
    	{
    		'name': 'WE tv',
    		'providers': {
    			'AT&T TV Now': 'add-on',
    			'AT&T Watch TV': true,
    			'Fubo TV': true,
    			'Hulu Live TV': false,
    			'Philo': true,
    			'Sling Blue': 'add-on',
    			'Sling Orange': 'add-on',
    			'YouTube TV': true,
    		},
    	},
    ];

    var providersData = [{
    	name: 'AT&T TV Now',
    	url: 'https://cdn.directv.com/content/dam/dtv/gmott/html/compare-packages-account.html',
    }, {
    	name: 'AT&T Watch TV',
    	url: 'https://www.attwatchtv.com/',
    }, {
    	name: 'Fubo TV',
    	url: 'https://www.fubo.tv/',
    }, {
    	name: 'Hulu Live TV',
    	url: 'https://www.hulu.com/live-tv',
    }, {
    	name: 'Philo',
    	url: 'https://philo.com/',
    }, {
    	name: 'Sling Blue',
    	url: 'https://www.sling.com/service',
    }, {
    	name: 'Sling Orange',
    	url: 'https://www.sling.com/service',
    }, {
    	name: 'YouTube TV',
    	url: 'https://tv.youtube.com/welcome/',
    }];

    /* components/ChannelList.svelte generated by Svelte v3.16.7 */

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[13] = list[i];
    	return child_ctx;
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[10] = list[i];
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[13] = list[i];
    	return child_ctx;
    }

    // (54:4) {#each providers as provider}
    function create_each_block_2(ctx) {
    	let th;
    	let a;
    	let t0_value = /*provider*/ ctx[13].name + "";
    	let t0;
    	let a_href_value;
    	let t1;

    	return {
    		c() {
    			th = element("th");
    			a = element("a");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(a, "href", a_href_value = /*provider*/ ctx[13].url);
    			attr(a, "target", "_blank");
    			attr(a, "class", "svelte-1yj86mv");
    			attr(th, "scope", "col");
    		},
    		m(target, anchor) {
    			insert(target, th, anchor);
    			append(th, a);
    			append(a, t0);
    			append(th, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*providers*/ 1 && t0_value !== (t0_value = /*provider*/ ctx[13].name + "")) set_data(t0, t0_value);

    			if (dirty & /*providers*/ 1 && a_href_value !== (a_href_value = /*provider*/ ctx[13].url)) {
    				attr(a, "href", a_href_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(th);
    		}
    	};
    }

    // (65:4) {#each Object.keys(channel.providers) as provider}
    function create_each_block_1(ctx) {
    	let td;
    	let span;
    	let t_value = /*channel*/ ctx[10].providers[/*provider*/ ctx[13]].text + "";
    	let t;
    	let span_class_value;

    	return {
    		c() {
    			td = element("td");
    			span = element("span");
    			t = text(t_value);
    			attr(span, "class", span_class_value = "badge badge-pill " + /*channel*/ ctx[10].providers[/*provider*/ ctx[13]].className);
    		},
    		m(target, anchor) {
    			insert(target, td, anchor);
    			append(td, span);
    			append(span, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*displayChannels*/ 4 && t_value !== (t_value = /*channel*/ ctx[10].providers[/*provider*/ ctx[13]].text + "")) set_data(t, t_value);

    			if (dirty & /*displayChannels*/ 4 && span_class_value !== (span_class_value = "badge badge-pill " + /*channel*/ ctx[10].providers[/*provider*/ ctx[13]].className)) {
    				attr(span, "class", span_class_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(td);
    		}
    	};
    }

    // (62:3) {#each displayChannels as channel}
    function create_each_block(ctx) {
    	let tr;
    	let th;
    	let t0_value = /*channel*/ ctx[10].name + "";
    	let t0;
    	let t1;
    	let t2;
    	let each_value_1 = Object.keys(/*channel*/ ctx[10].providers);
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			tr = element("tr");
    			th = element("th");
    			t0 = text(t0_value);
    			t1 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t2 = space();
    			attr(th, "scope", "row");
    		},
    		m(target, anchor) {
    			insert(target, tr, anchor);
    			append(tr, th);
    			append(th, t0);
    			append(tr, t1);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tr, null);
    			}

    			append(tr, t2);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*displayChannels*/ 4 && t0_value !== (t0_value = /*channel*/ ctx[10].name + "")) set_data(t0, t0_value);

    			if (dirty & /*displayChannels, Object*/ 4) {
    				each_value_1 = Object.keys(/*channel*/ ctx[10].providers);
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tr, t2);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(tr);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div;
    	let table;
    	let thead;
    	let tr;
    	let th;
    	let t1;
    	let t2;
    	let tbody;
    	let each_value_2 = /*providers*/ ctx[0];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks_1[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	let each_value = /*displayChannels*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			div = element("div");
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th = element("th");
    			th.textContent = "Channel";
    			t1 = space();

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t2 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(th, "scope", "col");
    			attr(table, "class", "table table-hover table-bordered");
    			toggle_class(table, "table-dark", /*isDarkMode*/ ctx[1]);
    			attr(div, "class", "table-responsive");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, table);
    			append(table, thead);
    			append(thead, tr);
    			append(tr, th);
    			append(tr, t1);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(tr, null);
    			}

    			append(table, t2);
    			append(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*providers*/ 1) {
    				each_value_2 = /*providers*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_2(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(tr, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_2.length;
    			}

    			if (dirty & /*Object, displayChannels*/ 4) {
    				each_value = /*displayChannels*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*isDarkMode*/ 2) {
    				toggle_class(table, "table-dark", /*isDarkMode*/ ctx[1]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { providers = [] } = $$props;
    	let { channels = [] } = $$props;
    	let { isDarkMode = false } = $$props;

    	const badge = (className, text) => {
    		return { className, text };
    	};

    	const yes = badge("badge-primary", "Yes");
    	const no = badge("badge-danger", "No");
    	const addon = badge("badge-warning", "Add-on");

    	const getBadge = (channel, provider) => {
    		const providerChannelSupport = channel.providers[provider.name];

    		if (providerChannelSupport === "add-on") {
    			return addon;
    		} else if (providerChannelSupport) {
    			return yes;
    		} else {
    			return no;
    		}
    	};

    	const calcDisplayChannel = (channels, providers) => {
    		return channels.map(channel => {
    			const providerBadges = providers.reduce(
    				(acc, provider) => {
    					return Object.assign({}, acc, {
    						[provider.name]: getBadge(channel, provider)
    					});
    				},
    				{}
    			);

    			return Object.assign({}, channel, { providers: providerBadges });
    		});
    	};

    	$$self.$set = $$props => {
    		if ("providers" in $$props) $$invalidate(0, providers = $$props.providers);
    		if ("channels" in $$props) $$invalidate(3, channels = $$props.channels);
    		if ("isDarkMode" in $$props) $$invalidate(1, isDarkMode = $$props.isDarkMode);
    	};

    	let displayChannels;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*channels, providers*/ 9) {
    			 $$invalidate(2, displayChannels = calcDisplayChannel(channels, providers));
    		}
    	};

    	return [providers, isDarkMode, displayChannels, channels];
    }

    class ChannelList extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { providers: 0, channels: 3, isDarkMode: 1 });
    	}
    }

    /* components/VisibilitySelector.svelte generated by Svelte v3.16.7 */

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[7] = list[i];
    	return child_ctx;
    }

    // (22:4) {#each items as item}
    function create_each_block$1(ctx) {
    	let tr;
    	let th;
    	let t0_value = /*item*/ ctx[7][/*displayProperty*/ ctx[3]] + "";
    	let t0;
    	let t1;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[6](/*item*/ ctx[7], ...args);
    	}

    	return {
    		c() {
    			tr = element("tr");
    			th = element("th");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(th, "scope", "row");
    			set_style(tr, "cursor", "pointer");
    			toggle_class(tr, "bg-primary", /*shown*/ ctx[0][/*item*/ ctx[7][/*displayProperty*/ ctx[3]]]);
    			dispose = listen(tr, "click", click_handler);
    		},
    		m(target, anchor) {
    			insert(target, tr, anchor);
    			append(tr, th);
    			append(th, t0);
    			append(tr, t1);
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*items, displayProperty*/ 12 && t0_value !== (t0_value = /*item*/ ctx[7][/*displayProperty*/ ctx[3]] + "")) set_data(t0, t0_value);

    			if (dirty & /*shown, items, displayProperty*/ 13) {
    				toggle_class(tr, "bg-primary", /*shown*/ ctx[0][/*item*/ ctx[7][/*displayProperty*/ ctx[3]]]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(tr);
    			dispose();
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let table;
    	let thead;
    	let tr;
    	let th;
    	let t0;
    	let t1;
    	let tbody;
    	let each_value = /*items*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	return {
    		c() {
    			table = element("table");
    			thead = element("thead");
    			tr = element("tr");
    			th = element("th");
    			t0 = text(/*context*/ ctx[1]);
    			t1 = space();
    			tbody = element("tbody");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			set_style(th, "width", "100vw");
    			attr(thead, "class", "thead-inverse");
    			attr(table, "class", "table table-hover text-center table-bordered table-responsive");
    			toggle_class(table, "table-dark", /*isDarkMode*/ ctx[4]);
    		},
    		m(target, anchor) {
    			insert(target, table, anchor);
    			append(table, thead);
    			append(thead, tr);
    			append(tr, th);
    			append(th, t0);
    			append(table, t1);
    			append(table, tbody);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tbody, null);
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*context*/ 2) set_data(t0, /*context*/ ctx[1]);

    			if (dirty & /*shown, items, displayProperty, showItem*/ 45) {
    				each_value = /*items*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tbody, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*isDarkMode*/ 16) {
    				toggle_class(table, "table-dark", /*isDarkMode*/ ctx[4]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(table);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { context } = $$props;
    	let { items = [] } = $$props;
    	let { shown = {} } = $$props;
    	let { displayProperty = "" } = $$props;
    	let { isDarkMode = false } = $$props;

    	function showItem(item, show) {
    		$$invalidate(0, shown = { ...shown, [item[displayProperty]]: show });
    		localStorage.setItem(`shown${context}`, JSON.stringify(shown));
    	}

    	const click_handler = (item, e) => showItem(item, !shown[item[displayProperty]]);

    	$$self.$set = $$props => {
    		if ("context" in $$props) $$invalidate(1, context = $$props.context);
    		if ("items" in $$props) $$invalidate(2, items = $$props.items);
    		if ("shown" in $$props) $$invalidate(0, shown = $$props.shown);
    		if ("displayProperty" in $$props) $$invalidate(3, displayProperty = $$props.displayProperty);
    		if ("isDarkMode" in $$props) $$invalidate(4, isDarkMode = $$props.isDarkMode);
    	};

    	return [shown, context, items, displayProperty, isDarkMode, showItem, click_handler];
    }

    class VisibilitySelector extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {
    			context: 1,
    			items: 2,
    			shown: 0,
    			displayProperty: 3,
    			isDarkMode: 4
    		});
    	}
    }

    /* components/Main.svelte generated by Svelte v3.16.7 */

    function create_else_block_2(ctx) {
    	let p;

    	return {
    		c() {
    			p = element("p");

    			p.innerHTML = `
        Way
        <a style="color: unset" href="https://en.wikipedia.org/wiki/Over-the-top_content" target="_blank">
          Over the Top
        </a>`;

    			attr(p, "class", "h3 d-none d-sm-block");
    			toggle_class(p, "text-white", /*isDarkMode*/ ctx[0]);
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*isDarkMode*/ 1) {
    				toggle_class(p, "text-white", /*isDarkMode*/ ctx[0]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    		}
    	};
    }

    // (116:6) {#if pickingMode}
    function create_if_block_3(ctx) {
    	let button0;
    	let t1;
    	let button1;
    	let dispose;

    	return {
    		c() {
    			button0 = element("button");
    			button0.textContent = "Select All";
    			t1 = space();
    			button1 = element("button");
    			button1.textContent = "Select None";
    			attr(button0, "class", "btn btn-outline-primary pick-buttons svelte-selrra");
    			attr(button1, "class", "btn btn-outline-primary pick-buttons svelte-selrra");

    			dispose = [
    				listen(button0, "click", /*click_handler*/ ctx[14]),
    				listen(button1, "click", /*click_handler_1*/ ctx[15])
    			];
    		},
    		m(target, anchor) {
    			insert(target, button0, anchor);
    			insert(target, t1, anchor);
    			insert(target, button1, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(button0);
    			if (detaching) detach(t1);
    			if (detaching) detach(button1);
    			run_all(dispose);
    		}
    	};
    }

    // (146:4) {:else}
    function create_else_block_1(ctx) {
    	let button0;
    	let t1;
    	let button1;
    	let dispose;

    	return {
    		c() {
    			button0 = element("button");
    			button0.textContent = "Pick Channels";
    			t1 = space();
    			button1 = element("button");
    			button1.textContent = "Pick Providers";
    			attr(button0, "class", "btn btn-outline-primary pick-buttons svelte-selrra");
    			attr(button1, "class", "btn btn-outline-primary pick-buttons svelte-selrra");

    			dispose = [
    				listen(button0, "click", /*click_handler_3*/ ctx[17]),
    				listen(button1, "click", /*click_handler_4*/ ctx[18])
    			];
    		},
    		m(target, anchor) {
    			insert(target, button0, anchor);
    			insert(target, t1, anchor);
    			insert(target, button1, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(button0);
    			if (detaching) detach(t1);
    			if (detaching) detach(button1);
    			run_all(dispose);
    		}
    	};
    }

    // (140:4) {#if pickingMode}
    function create_if_block_2(ctx) {
    	let button;
    	let dispose;

    	return {
    		c() {
    			button = element("button");
    			button.textContent = "Done";
    			attr(button, "class", "btn btn-outline-primary pick-buttons svelte-selrra");
    			dispose = listen(button, "click", /*click_handler_2*/ ctx[16]);
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(button);
    			dispose();
    		}
    	};
    }

    // (176:2) {:else}
    function create_else_block(ctx) {
    	let current;

    	const channellist = new ChannelList({
    			props: {
    				isDarkMode: /*isDarkMode*/ ctx[0],
    				channels: /*visibleChannels*/ ctx[7],
    				providers: /*visibleProviders*/ ctx[8]
    			}
    		});

    	return {
    		c() {
    			create_component(channellist.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(channellist, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const channellist_changes = {};
    			if (dirty & /*isDarkMode*/ 1) channellist_changes.isDarkMode = /*isDarkMode*/ ctx[0];
    			if (dirty & /*visibleChannels*/ 128) channellist_changes.channels = /*visibleChannels*/ ctx[7];
    			if (dirty & /*visibleProviders*/ 256) channellist_changes.providers = /*visibleProviders*/ ctx[8];
    			channellist.$set(channellist_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(channellist.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(channellist.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(channellist, detaching);
    		}
    	};
    }

    // (168:29) 
    function create_if_block_1(ctx) {
    	let updating_items;
    	let updating_visibleItems;
    	let updating_shown;
    	let current;

    	function providerselector_items_binding(value) {
    		/*providerselector_items_binding*/ ctx[22].call(null, value);
    	}

    	function providerselector_visibleItems_binding(value_1) {
    		/*providerselector_visibleItems_binding*/ ctx[23].call(null, value_1);
    	}

    	function providerselector_shown_binding(value_2) {
    		/*providerselector_shown_binding*/ ctx[24].call(null, value_2);
    	}

    	let providerselector_props = {
    		context: "Providers",
    		displayProperty: "name",
    		isDarkMode: /*isDarkMode*/ ctx[0]
    	};

    	if (/*providers*/ ctx[6] !== void 0) {
    		providerselector_props.items = /*providers*/ ctx[6];
    	}

    	if (/*visibleProviders*/ ctx[8] !== void 0) {
    		providerselector_props.visibleItems = /*visibleProviders*/ ctx[8];
    	}

    	if (/*shownProviders*/ ctx[4] !== void 0) {
    		providerselector_props.shown = /*shownProviders*/ ctx[4];
    	}

    	const providerselector = new VisibilitySelector({ props: providerselector_props });
    	binding_callbacks.push(() => bind(providerselector, "items", providerselector_items_binding));
    	binding_callbacks.push(() => bind(providerselector, "visibleItems", providerselector_visibleItems_binding));
    	binding_callbacks.push(() => bind(providerselector, "shown", providerselector_shown_binding));

    	return {
    		c() {
    			create_component(providerselector.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(providerselector, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const providerselector_changes = {};
    			if (dirty & /*isDarkMode*/ 1) providerselector_changes.isDarkMode = /*isDarkMode*/ ctx[0];

    			if (!updating_items && dirty & /*providers*/ 64) {
    				updating_items = true;
    				providerselector_changes.items = /*providers*/ ctx[6];
    				add_flush_callback(() => updating_items = false);
    			}

    			if (!updating_visibleItems && dirty & /*visibleProviders*/ 256) {
    				updating_visibleItems = true;
    				providerselector_changes.visibleItems = /*visibleProviders*/ ctx[8];
    				add_flush_callback(() => updating_visibleItems = false);
    			}

    			if (!updating_shown && dirty & /*shownProviders*/ 16) {
    				updating_shown = true;
    				providerselector_changes.shown = /*shownProviders*/ ctx[4];
    				add_flush_callback(() => updating_shown = false);
    			}

    			providerselector.$set(providerselector_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(providerselector.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(providerselector.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(providerselector, detaching);
    		}
    	};
    }

    // (160:2) {#if channelPickMode}
    function create_if_block(ctx) {
    	let updating_items;
    	let updating_visibleItems;
    	let updating_shown;
    	let current;

    	function channelselector_items_binding(value) {
    		/*channelselector_items_binding*/ ctx[19].call(null, value);
    	}

    	function channelselector_visibleItems_binding(value_1) {
    		/*channelselector_visibleItems_binding*/ ctx[20].call(null, value_1);
    	}

    	function channelselector_shown_binding(value_2) {
    		/*channelselector_shown_binding*/ ctx[21].call(null, value_2);
    	}

    	let channelselector_props = {
    		context: "Channels",
    		displayProperty: "name",
    		isDarkMode: /*isDarkMode*/ ctx[0]
    	};

    	if (/*channels*/ ctx[5] !== void 0) {
    		channelselector_props.items = /*channels*/ ctx[5];
    	}

    	if (/*visibleChannels*/ ctx[7] !== void 0) {
    		channelselector_props.visibleItems = /*visibleChannels*/ ctx[7];
    	}

    	if (/*shownChannels*/ ctx[3] !== void 0) {
    		channelselector_props.shown = /*shownChannels*/ ctx[3];
    	}

    	const channelselector = new VisibilitySelector({ props: channelselector_props });
    	binding_callbacks.push(() => bind(channelselector, "items", channelselector_items_binding));
    	binding_callbacks.push(() => bind(channelselector, "visibleItems", channelselector_visibleItems_binding));
    	binding_callbacks.push(() => bind(channelselector, "shown", channelselector_shown_binding));

    	return {
    		c() {
    			create_component(channelselector.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(channelselector, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const channelselector_changes = {};
    			if (dirty & /*isDarkMode*/ 1) channelselector_changes.isDarkMode = /*isDarkMode*/ ctx[0];

    			if (!updating_items && dirty & /*channels*/ 32) {
    				updating_items = true;
    				channelselector_changes.items = /*channels*/ ctx[5];
    				add_flush_callback(() => updating_items = false);
    			}

    			if (!updating_visibleItems && dirty & /*visibleChannels*/ 128) {
    				updating_visibleItems = true;
    				channelselector_changes.visibleItems = /*visibleChannels*/ ctx[7];
    				add_flush_callback(() => updating_visibleItems = false);
    			}

    			if (!updating_shown && dirty & /*shownChannels*/ 8) {
    				updating_shown = true;
    				channelselector_changes.shown = /*shownChannels*/ ctx[3];
    				add_flush_callback(() => updating_shown = false);
    			}

    			channelselector.$set(channelselector_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(channelselector.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(channelselector.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(channelselector, detaching);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let div3;
    	let div2;
    	let div0;
    	let t0;
    	let div1;
    	let t1;
    	let current_block_type_index;
    	let if_block2;
    	let current;

    	function select_block_type(ctx, dirty) {
    		if (/*pickingMode*/ ctx[9]) return create_if_block_3;
    		return create_else_block_2;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block0 = current_block_type(ctx);

    	function select_block_type_1(ctx, dirty) {
    		if (/*pickingMode*/ ctx[9]) return create_if_block_2;
    		return create_else_block_1;
    	}

    	let current_block_type_1 = select_block_type_1(ctx);
    	let if_block1 = current_block_type_1(ctx);
    	const if_block_creators = [create_if_block, create_if_block_1, create_else_block];
    	const if_blocks = [];

    	function select_block_type_2(ctx, dirty) {
    		if (/*channelPickMode*/ ctx[2]) return 0;
    		if (/*providerPickMode*/ ctx[1]) return 1;
    		return 2;
    	}

    	current_block_type_index = select_block_type_2(ctx);
    	if_block2 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			div3 = element("div");
    			div2 = element("div");
    			div0 = element("div");
    			if_block0.c();
    			t0 = space();
    			div1 = element("div");
    			if_block1.c();
    			t1 = space();
    			if_block2.c();
    			attr(div0, "class", "mr-auto");
    			attr(div2, "class", "d-flex mb-1 mt-1");
    			toggle_class(div2, "sticky", /*pickingMode*/ ctx[9]);
    			attr(div3, "class", "container");
    		},
    		m(target, anchor) {
    			insert(target, div3, anchor);
    			append(div3, div2);
    			append(div2, div0);
    			if_block0.m(div0, null);
    			append(div2, t0);
    			append(div2, div1);
    			if_block1.m(div1, null);
    			append(div3, t1);
    			if_blocks[current_block_type_index].m(div3, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
    				if_block0.p(ctx, dirty);
    			} else {
    				if_block0.d(1);
    				if_block0 = current_block_type(ctx);

    				if (if_block0) {
    					if_block0.c();
    					if_block0.m(div0, null);
    				}
    			}

    			if (current_block_type_1 === (current_block_type_1 = select_block_type_1(ctx)) && if_block1) {
    				if_block1.p(ctx, dirty);
    			} else {
    				if_block1.d(1);
    				if_block1 = current_block_type_1(ctx);

    				if (if_block1) {
    					if_block1.c();
    					if_block1.m(div1, null);
    				}
    			}

    			if (dirty & /*pickingMode*/ 512) {
    				toggle_class(div2, "sticky", /*pickingMode*/ ctx[9]);
    			}

    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type_2(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block2 = if_blocks[current_block_type_index];

    				if (!if_block2) {
    					if_block2 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block2.c();
    				}

    				transition_in(if_block2, 1);
    				if_block2.m(div3, null);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block2);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block2);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div3);
    			if_block0.d();
    			if_block1.d();
    			if_blocks[current_block_type_index].d();
    		}
    	};
    }

    function sortArrayByProperty(array, prop) {
    	return array.slice().sort((a, b) => {
    		const first = a[prop].toUpperCase();
    		const next = b[prop].toUpperCase();

    		if (first < next) {
    			return -1;
    		} else return 1;
    	});
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let isDarkMode = false;
    	let providerPickMode = false;
    	let channelPickMode = false;
    	let shownChannels = {};
    	let shownProviders = {};
    	let channels = sortArrayByProperty(channelsData, "name");
    	let providers = sortArrayByProperty(providersData, "name");

    	if (window.matchMedia) {
    		const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");

    		function colorSchemeChange(mql) {
    			$$invalidate(0, isDarkMode = mql.matches);
    			console.log(`darkMode: ${isDarkMode}`);
    		}

    		mediaQueryList.addListener(colorSchemeChange);
    		colorSchemeChange(mediaQueryList);
    	}

    	channels.forEach(channel => $$invalidate(3, shownChannels[channel.name] = true, shownChannels));
    	providers.forEach(provider => $$invalidate(4, shownProviders[provider.name] = true, shownProviders));
    	const localStorageShownChannels = localStorage.getItem("shownChannels");

    	if (localStorageShownChannels) {
    		Object.assign(shownChannels, JSON.parse(localStorageShownChannels));
    	}

    	const localStorageShownProviders = localStorage.getItem("shownProviders");

    	if (localStorageShownProviders) {
    		let providersForMigration = JSON.parse(localStorageShownProviders);

    		if (providersForMigration["Sling TV"]) {
    			providersForMigration["Sling Orange"] = providersForMigration["Sling TV"];
    			providersForMigration["Sling Blue"] = providersForMigration["Sling TV"];
    			delete providersForMigration["Sling TV"];
    		}

    		if (providersForMigration["DirecTV Now"]) {
    			providersForMigration["AT&T TV Now"] = providersForMigration["DirecTV Now"];
    			delete providersForMigration["DirecTV Now"];
    		}

    		delete providersForMigration["PlayStation Vue"];
    		Object.assign(shownProviders, providersForMigration);
    		localStorage.setItem("shownProviders", JSON.stringify(providersForMigration));
    	}

    	function showAll(show) {
    		if (channelPickMode) {
    			Object.keys(shownChannels).forEach(channel => {
    				$$invalidate(3, shownChannels[channel] = show, shownChannels);
    			});

    			if (show) localStorage.removeItem("shownChannels"); else localStorage.setItem("shownChannels", JSON.stringify(shownChannels));
    		} else if (providerPickMode) {
    			Object.keys(shownProviders).forEach(provider => {
    				$$invalidate(4, shownProviders[provider] = show, shownProviders);
    			});

    			if (show) localStorage.removeItem("shownProviders"); else localStorage.setItem("shownProviders", JSON.stringify(shownProviders));
    		}
    	}

    	function donePicking() {
    		$$invalidate(2, channelPickMode = false);
    		$$invalidate(1, providerPickMode = false);
    	}

    	const click_handler = e => showAll(true);
    	const click_handler_1 = e => showAll(false);
    	const click_handler_2 = e => donePicking();
    	const click_handler_3 = e => $$invalidate(2, channelPickMode = true);
    	const click_handler_4 = e => $$invalidate(1, providerPickMode = true);

    	function channelselector_items_binding(value) {
    		channels = value;
    		$$invalidate(5, channels);
    	}

    	function channelselector_visibleItems_binding(value_1) {
    		visibleChannels = value_1;
    		(($$invalidate(7, visibleChannels), $$invalidate(5, channels)), $$invalidate(3, shownChannels));
    	}

    	function channelselector_shown_binding(value_2) {
    		shownChannels = value_2;
    		$$invalidate(3, shownChannels);
    	}

    	function providerselector_items_binding(value) {
    		providers = value;
    		$$invalidate(6, providers);
    	}

    	function providerselector_visibleItems_binding(value_1) {
    		visibleProviders = value_1;
    		(($$invalidate(8, visibleProviders), $$invalidate(6, providers)), $$invalidate(4, shownProviders));
    	}

    	function providerselector_shown_binding(value_2) {
    		shownProviders = value_2;
    		$$invalidate(4, shownProviders);
    	}

    	let visibleChannels;
    	let visibleProviders;
    	let pickingMode;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*channels, shownChannels*/ 40) {
    			 $$invalidate(7, visibleChannels = channels.filter(channel => shownChannels[channel.name]));
    		}

    		if ($$self.$$.dirty & /*providers, shownProviders*/ 80) {
    			 $$invalidate(8, visibleProviders = providers.filter(provider => shownProviders[provider.name]));
    		}

    		if ($$self.$$.dirty & /*channelPickMode, providerPickMode*/ 6) {
    			 $$invalidate(9, pickingMode = channelPickMode || providerPickMode);
    		}
    	};

    	return [
    		isDarkMode,
    		providerPickMode,
    		channelPickMode,
    		shownChannels,
    		shownProviders,
    		channels,
    		providers,
    		visibleChannels,
    		visibleProviders,
    		pickingMode,
    		showAll,
    		donePicking,
    		localStorageShownChannels,
    		localStorageShownProviders,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		click_handler_3,
    		click_handler_4,
    		channelselector_items_binding,
    		channelselector_visibleItems_binding,
    		channelselector_shown_binding,
    		providerselector_items_binding,
    		providerselector_visibleItems_binding,
    		providerselector_shown_binding
    	];
    }

    class Main extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});
    	}
    }

    new Main({
    	target: document.querySelector('main'),
    });

}());
//# sourceMappingURL=bundle.js.map
