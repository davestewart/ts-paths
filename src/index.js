const Path = require('path')
const Fs = require('fs')

// ---------------------------------------------------------------------------------------------------------------------
// factories
// ---------------------------------------------------------------------------------------------------------------------

function makeSettings () {
  return {
    root: '',
    configFile: '',
    prefix: '@',
    folders: [],
    modules: []
  }
}

function makeConfig () {
  const root = settings.root || ''
  return {
    rootUrl: Path.resolve('./', root),
    baseUrl: '',
    paths: {},
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// loaders
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Load user settings from package.json
 */
function loadSettings () {
  try {
    const json = JSON.parse(Fs.readFileSync('package.json', 'utf8'))
    const data = json['alias-hq']
    if (data) {
      if (data.root) {
        config.rootUrl = Path.resolve(data.root)
      }
      Object.assign(settings, makeSettings(), data)
      return true
    }
  }
  catch (err) {
    return false
  }
}

/**
 * Load js/tsconfig.json file
 *
 * @param   {string}    path      The absolute path to the config file
 */
function loadConfig (path) {
  // load
  let json
  const text = Fs.readFileSync(path, 'utf8')
  if (text) {
    try { json = JSON.parse(text) }
    catch (err) {}
  }

  // config
  const compilerOptions = json && json.compilerOptions
  if (compilerOptions && compilerOptions.paths) {
    // config
    config.rootUrl = Path.dirname(path)
    config.baseUrl = compilerOptions.baseUrl || ''
    config.paths = compilerOptions.paths || {}

    // settings
    settings.configFile = path

    // done
    return true
  }

  // normal file
  config.paths = {}
}

// ---------------------------------------------------------------------------------------------------------------------
// api
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Load config
 *
 * @param   {undefined}         value     Pass no value for to determine config file automatically
 * @param   {string}            value     Pass an absolute path to load from alternate location
 * @returns {object}                      The Alias HQ instance
 */
function load (value = undefined) {
  // load settings
  loadSettings()

  // string: relative or absolute path passed
  if (typeof value === 'string') {
    const path = Path.resolve(value)
    if (Fs.existsSync(path)) {
      loadConfig(path)
    }
    else {
      throw new Error(`No such file "${path}"`)
    }
  }

  // no value: default or configured config file
  else if (typeof value === 'undefined') {
    // variables
    let found = false
    const files = [
      'jsconfig.json',
      'tsconfig.base.json',
      'tsconfig.json',
    ]

    // attempt to load file
    while (files.length && !found) {
      const file = files.shift()
      // config.rootUrl will be an absolute folder path if loaded from package.json
      const path = Path.resolve(config.rootUrl, file)
      if (Fs.existsSync(path)) {
        found = loadConfig(path)
      }
    }

    // could not load file!
    if (!found) {
      Object.assign(config, makeConfig())
    }
  }

  // any other value
  else {
    throw new Error('Invalid parameter "value"')
  }

  // return
  return this
}

/**
 * Convert paths config using a plugin or callback
 *
 * @param   {string}    plugin    The name of an available plugin
 * @param   {function}  plugin    A custom function
 * @param   {object}   [options]  Any options to pass to the plugin
 */
function get (plugin, options = {}) {
  // load defaults if not loaded
  if (!config.paths) {
    load()
  }

  // callback
  if (typeof plugin === 'function') {
    return plugin(config, options)
  }

  // plugin
  if (typeof plugin === 'string') {
    // check for custom plugin
    if (typeof plugins.custom[plugin] === 'function') {
      const callback = plugins.custom[plugin]
      return callback(config, options)
    }

    // check for built-in plugin
    const path = Path.resolve(__dirname, `./plugins/${plugin}/index.js`)
    if (Fs.existsSync(path)) {
      const callback = require(path)
      return callback(config, options)
    }
    throw new Error(`No such plugin "${plugin}"`)
  }

  // invalid
  throw new Error(`Invalid "plugin" parameter`)
}

// ---------------------------------------------------------------------------------------------------------------------
// members
// ---------------------------------------------------------------------------------------------------------------------

const settings = makeSettings()

const config = makeConfig()

const plugins = {
  custom: {},

  /**
   * Add a plugin to the core setup
   *
   * @param   {string}    name        The plugin name
   * @param   {function}  callback    The plugin function
   * @returns {object}                The Alias HQ instance
   */
  add (name, callback) {
    if (!this.custom[name] && typeof callback === 'function') {
      this.custom[name] = callback
    }
    return this
  },

  /**
   * List available plugin names
   *
   * @returns {string[]}
   */
  get names () {
    const path = Path.resolve(__dirname, 'plugins')
    const items = Fs.readdirSync(path).map(file => file.replace('.js', ''))
    Object.keys(this.custom).forEach(key => {
      if (!items.includes(key)) {
        items.push(key)
      }
    })
    return items.sort()
  },
}

module.exports = {
  get,
  load,
  config,
  plugins,
  settings,
}
