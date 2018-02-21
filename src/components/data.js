import Recipe from './Recipe'
import store from '../store'
import i18n from '../i18n'

let luaState
let _meta

let loaded = {}

let quantorioBridge = {
  fs: {},
  files: {},
  getFileContent: function (path) {
    let content = this.files[path]
    return content
  },
  exists: function (path) {
    let dir = this.fs
    return !path.split('/').some(part => !(dir = dir[part]))
  },
  readDir: function (path) {
    let dir = this.fs
    path.split('/').forEach(part => dir ? (dir = dir[part]) : false)
    if (!dir) { return '' }
    return Object.keys(dir).join('|')
  }
}

window.quantorioBridge = quantorioBridge

let callLua = (mods, onlyLanguage) => {
  return import('lua.vm.js').then(LuaVM => {
    let modules = [
      'core',
      'base',
    ]
    mods = mods || []
    modules = modules.concat(mods)

    if (!luaState) {
      luaState = new LuaVM.Lua.State()

      luaState.push(quantorioBridge)
      luaState.setglobal('quantorioBridge')

      luaState.execute(`
        require("quantorio")
        require("dataloader")
        generator = require("generator")
        dkjson = require 'dkjson'
      `)
    }

    if (onlyLanguage) {
      luaState.execute(`
        data.raw = {}
        loadLanguages({'${modules.join("','")}'}, ${modules.length})
        quantorioBridge.meta = dkjson.encode(generator.getMeta())
        `)
      quantorioBridge.meta = JSON.parse(quantorioBridge.meta)
      setTranslation(quantorioBridge.meta)
    } else {
      luaState.execute(`
        data.raw = {}
        quantorioBridge.meta = dkjson.encode(browserParse({'${modules.join("','")}'}, ${modules.length}))
      `)

      quantorioBridge.meta = parseMeta(JSON.parse(quantorioBridge.meta))

      // for debug
      window.fs = quantorioBridge.fs
      window.files = quantorioBridge.files
      window.meta = quantorioBridge.meta
    }

    return quantorioBridge.meta
  })
}

let sortByOrder = (a, b) => {
  if (!a) {
    return -1
  } else if (!b) {
    return 1
  }
  let aName = a.showName || a.name
  let bName = b.showName || b.name
  let aOrders, bOrders
  aOrders = _meta.items[aName].order.split('-')
  bOrders = _meta.items[bName].order.split('-')
  try {
  } catch (error) {
  }
  for (let i = 0; i < Math.max(aOrders.length, bOrders.length); i++) {
    if (aOrders[i] === undefined) {
      return -1
    }
    if (bOrders[i] === undefined) {
      return 1
    }
    if (aOrders[i] !== bOrders[i]) {
      return aOrders[i] > bOrders[i] ? 1 : -1
    }
  }
  aName = parseInt(aName.replace(/^.*-/, ''))
  bName = parseInt(bName.replace(/^.*-/, ''))

  if (aName > bName) {
    return 1
  } else if (aName < bName) {
    return -1
  }
  return 0
}

let parseMeta = (meta) => {
  // for sorting
  _meta = meta

  // flip, sort, flip back
  let languages = meta.languages
  let fliped = {}
  Object.keys(languages).forEach(k => {
    fliped[languages[k]] = k
  })
  meta.languages = {}
  Object.keys(fliped).sort().forEach(k => {
    meta.languages[fliped[k]] = k
  })

  meta.modules.sort(sortByOrder)
  meta.modules.unshift(null)

  meta.inserters.sort((a, b) => sortByOrder(meta.items[a.name], meta.items[b.name]))

  meta.machines.sort((a, b) => {
    // put player first
    if (a.name === 'player') {
      return -1
    } else if (b.name === 'player') {
      return 1
    }

    if (a.name > b.name) {
      return 1
    } else {
      return -1
    }
  })

  let recipes = {}

  Object.keys(meta.recipes).forEach(recipeName => {
    recipes[recipeName] = new Recipe(meta.recipes[recipeName])
  })
  meta.recipes = recipes

  Object.keys(meta.groups).forEach(groupName => {
    let group = meta.groups[groupName]
    if (!group.subgroups) {
      delete meta.groups[groupName]
      return
    }
    group.subgroupsWithItems = []
    let itemCount = 0

    Object.keys(group.subgroups).forEach(subgroupName => {
      if (meta.subgroups[subgroupName]) {
        // foreach the subgroup
        let subgroupItems = []
        Object.keys(group.subgroups[subgroupName]).forEach(itemName => {
          if (meta.items[itemName] && meta.recipes[itemName]) {
            let item = meta.recipes[itemName]

            subgroupItems.push(item)
            itemCount++
          }
          subgroupItems.sort(sortByOrder)
        })
        let subgroup = {
          order: group.subgroups[subgroupName],
          items: subgroupItems,
          name: subgroupName
        }
        group.subgroupsWithItems.push(subgroup)
      }
    })
    if (itemCount !== 0) {
      group.subgroupsWithItems.sort(sortByOrder)
    } else {
      delete meta.groups[groupName]
    }
  })
  meta.groups = Object.values(meta.groups).sort(sortByOrder)
  console.log('done')
  return meta
}

let extractZipToVirtualFS = (zips, prefix) => {
  console.log('extracting to virtual fs...')

  return import('lua.vm.js').then(LuaVM => {
    prefix = prefix || ''
    let rootDir
    let fs = quantorioBridge.fs
    if (prefix) {
      rootDir = fs
      fs[prefix] = fs[prefix] || {}
      rootDir = fs[prefix]
      prefix += '/'
    } else {
      rootDir = fs
    }

    let e = LuaVM.emscripten
    let promises = []

    try {
      e.FS_createFolder('/', 'locale', true, true)
    } catch (e) {}

    zips.forEach(([name, zip], index) => {
      let baseDir = rootDir

      zip.forEach((relativePath, file) => {
        if (file.dir) {
          let dir = baseDir
          file.name.split('/').forEach(part => {
            if (dir[part]) {
              dir = dir[part]
            } else if (part) {
              dir[part] = {}
            }
          })
          let matches = file.name.match(/(.*)\/(.+)/)
          if (!matches || !matches[2]) {
            matches = {
              '1': '',
              '2': file.name
            }
          }
        } else {
          let suffix = file.name.substring(file.name.length - 4, file.name.length)
          if (suffix === '.lua' || suffix === '.cfg' || suffix === '.ini' || suffix === 'json') {
            promises.push(file.async('text').then((content) => {
              quantorioBridge.files[prefix + file.name] = content

              let dir = baseDir
              file.name.split('/').forEach(part => {
                if (part && dir[part]) {
                  dir = dir[part]
                } else {
                  dir[part] = true
                }
              })

              let matches = file.name.match(/(.*)\/(.+)/)
              if (!matches) {
                matches = {
                  '1': '',
                  '2': file.name
                }
              }
              if (index === 3 && !file.dir && !prefix) {
                try {
                  return e.FS_createDataFile('/' + matches[1], matches[2], content, true, false)
                } catch (error) {
                  if (error.code !== 'EEXIST') {
                    throw error
                  }
                }
              }
            }))
          } else {
            promises.push(file.async('base64').then((content) => {
              quantorioBridge.files[prefix + file.name] = content
            }))
          }
        }
      })
    })
    return Promise.all(promises)
  })
}

let allFetches = []
let fetchEx = name => {
  console.log(name)
  return fetch(name, {mode: 'cors'})
  // Retrieve its body as ReadableStream
  .then(response => {
    let id = allFetches.length
    allFetches.push({
      length: 0,
      loaded: 0,
    })
    let length = response.headers.get('Content-Length')
    if (length) {
      allFetches[id].length = Number(length)
    }
    const reader = response.body.getReader()

    return new ReadableStream({
      start (controller) {
        return pump()

        function pump () {
          return reader.read().then(({ done, value }) => {
            // When no more data needs to be consumed, close the stream
            if (done) {
              controller.close()
              return
            }
            allFetches[id].loaded += value.byteLength
            let total = 0
            let loaded = 0
            allFetches.forEach(setup => {
              total += setup.length
              loaded += setup.loaded
            })
            store.commit('setNetworkProgress', loaded / (total + 1))
            // Enqueue the next data chunk into our target stream
            controller.enqueue(value)
            return pump()
          })
        }
      }
    })
  })
  .then(stream => new Response(stream))
  .then(response => response.blob())
}

let loadZip = (name, file) => {
  if (loaded[name]) {
    return loaded[name]
  }
  console.log('loading file ' + name)
  let p = import('jszip')
  let origName = name
  if (file) {
    p = p.then(JSZip => JSZip.loadAsync(file))
  } else {
    p = p.then(JSZip => {
      /*
      // wait for Access-Control-Expose-Headers: Content-Length
      if (process.env.TRAVIS_TAG) {
        name = `https://raw.githubusercontent.com/garveen/quantorio/${process.env.TRAVIS_TAG}/public/` + name
      }
      */
      return fetchEx(name + '.zip')
      .then(JSZip.loadAsync)
    })
  }
  p = p.then(zip => {
    return [name, zip]
  })
  loaded[origName] = p
  return p
}

let loadFiles = zips => {
  let promises = []
  zips.forEach(([name, file]) => {
    promises.push(loadZip(name, file))
  })
  return Promise.all(promises).then(zips => {
    let names = []
    zips.forEach(([_, zip]) => {
      let name = zip.folder(/^[^/]+\/$/)[0].name
      names.push(name.substring(0, name.length - 1))
    })
    return parse(zips, 'data', names)
  })
  .then(setVue)
}

let init = (fallbackLanguage) => {
  // fetchEx('sublime.rar').then(blob => {
  //   console.log(blob)
  // })
  return Promise.all([loadZip('lualib'), loadZip('core'), loadZip('base'), loadZip('quantorio'), loadZip(fallbackLanguage)])
  .then(parse)
  .then(setVue)
  .then(meta => {
    store.commit('setNetworkProgress', 1)
    loadTranslation(fallbackLanguage)
    return meta
  })
}

let setTranslation = (meta) => {
  Object.keys(meta.translations).forEach(lang => {
    let message = meta.translations[lang]
    try {
      message.el = require('element-ui/lib/locale/lang/' + lang).default.el
    } catch (ex) {
    }
    i18n.mergeLocaleMessage(lang, message)
    store.commit('saveTranslation', [lang, message])
  })
}

let loadTranslation = (name) => {
  store.commit('setLoading', true)
  return loadZip(name)
  .then(zip => {
    return parse([zip], undefined, undefined, true)
  })
  .then(meta => {
    setTranslation(meta)
    store.commit('loadedLanguage', name)
    store.commit('setLoading', false)
    return name
  })
}

let parse = (zips, prefix, mods, onlyLanguage) => {
  return extractZipToVirtualFS(zips, prefix)
  .then(() => {
    console.log('lua...')
    return callLua(mods, onlyLanguage)
  })
  .catch(error => {
    if (error.lua_stack) {
      console.error(error.lua_stack)
    } else {
      throw error
    }
  })
}

let setVue = (meta) => {
  store.commit('setMeta', meta)
  setTranslation(meta)
  return meta
}

export default {
  init: init,
  parse: parse,
  setVue: setVue,
  loadTranslation: loadTranslation,
  loadFiles: loadFiles,
  files: quantorioBridge.files,
}
