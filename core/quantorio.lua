old_print = print
_G.print = function(...)
	local info = debug.getinfo(2, 'Sl')
	local line = info.short_src .. ':' .. info.currentline .. ':'
	old_print(line, ...)
end
log = print
fs = {}

function isNode()
	return not js.global.window
end

function fs.readFile(filename)
	return quantorioBridge:getFileContent(filename)
end

function fs.exists(path)
	return quantorioBridge:exists(path)
end

function fs.readDir(path)
	local ret = {}
	for file in quantorioBridge:readDir(path):gmatch('[^|]+') do
		table.insert(ret, file)
	end
	return ret
end

package.path = '?.lua'

function findfile(filename)
	for i = 1, originPathsLength do
		local path = originPaths[i]
		filename = filename:gsub('%.', '/')
		local fullname = path:gsub('%?', filename)
		if fs.exists(fullname) then
			return fullname
		end

	end
	return false
end

function loadfile(filename)
	local fullname = findfile(filename)
	if not fullname then
		return
	end
	local content = fs.readFile(fullname)
	if content then
		loaded, err = load(content, '@' .. fullname)
		if loaded then
			return loaded, fullname
		else
			error(err)
		end
	end
end

for i = 1, #package.searchers do
  table.remove(package.searchers)
end

table.insert(package.searchers, 1, function(name)
	local loaded, path = loadfile(name)
	if loaded then return loaded, path end
end)



originPaths = {
  "lualib/?.lua",
  "data/core/lualib/?.lua",
  "core/?.lua",
}
originPathsLength = 3

generator = require 'generator'
dkjson = require 'dkjson'
require 'dataloader'
defines = require 'defines'

function dump(...)
	local info = debug.getinfo(2, 'Sl')
	local line = info.short_src .. ':' .. info.currentline .. ':'
	for _, v in ipairs({...}) do
		line = line .. ' ' .. dkjson.encode(v, {indent = true})
	end
	old_print(line)
end

function is_int(n)
	if type(n) ~= 'number' then return false end
	return n == math.floor(n)
end

function size(T)
  local count = 0
  for _ in pairs(T) do count = count + 1 end
  return count
end

local to_be_zipped = {}

function zipIt(name)
	to_be_zipped[name] = true
end

function loadModules(modules, modulesLength)
	local old_require = require

	require = function (filename)
		fullname = findfile(filename)
		zipIt(fullname)
		return old_require(filename)
	end
	-- backup package.loaded
	-- cannot assign directly by lua's design
	local ploaded = {}
	for k, v in pairs(package.loaded) do
		ploaded[k] = v
	end

	for _, filename in pairs({'data', 'data-updates', 'data-final-fixes'}) do
		for i = 1, modulesLength do
			for k, v in pairs(package.loaded) do
				package.loaded[k] = nil
			end
			for k, v in pairs(ploaded) do
				package.loaded[k] = v
			end
			local moduleName = modules[i]
			table.insert(originPaths, 1, 'data/' .. moduleName .. '/?.lua')
			originPathsLength = originPathsLength + 1
			local fullname = findfile(filename)
			if fullname then
				print('loading ' .. moduleName .. '/' .. filename .. '.lua')
				require(filename)
			else
			end
			originPathsLength = originPathsLength - 1
			table.remove(originPaths, 1)
		end
	end
	for k, v in pairs(package.loaded) do
		package.loaded[k] = nil
	end
	for k, v in pairs(ploaded) do
		package.loaded[k] = v
	end

	require = old_require

	return loadLanguages(modules, modulesLength)
end

function loadLanguages(modules, modulesLength)
	local mapping = {}
	for i = 1, modulesLength do
		local moduleName = modules[i]
		local part = moduleName:gmatch('[^_]+')()
		mapping['__' .. part .. '__'] = 'data/' .. moduleName
		generator.saveLanguages(moduleName)
		generator.saveQuantorioLanguages()
	end
	return mapping
end

function loadINI(file)
	local section = '{}'
	local data = {}
	data[section] = {}
	local testSection
	local str = fs.readFile(file, "utf8") .. '\n'
	for line in str:gmatch('(.-)\r?\n') do
		testSection = line:match('^%[([^%[%]]+)%]$')
		if testSection then
			section = tonumber(testSection) or testSection
			data[section] = data[section] or {};
		else
			local k, v = line:match('(.-)=(.+)')
			if k and v then
				if tonumber(v) then
					v = tonumber(v)
				elseif v == 'true' then
					v = true
				elseif v == 'false' then
					v = false
				end
				if tonumber(k) then
					k = tonumber(k)
				end
				data[section][k] = v
			end
		end
	end
	return data
end

function parse(modules, modulesLength)
	generator.init()
	local mapping = loadModules(modules, modulesLength)
	generator.parse(data.raw, mapping)
	local files = generator.finalize()
	local meta = generator.getMeta()
	return meta, files
end

function browserParse(modules, modulesLength)
	local meta = parse(modules, modulesLength)
	return meta
end


function localParse()
	local modules = {'core', 'base'}
	local modulesLength = 2
	local meta, files = parse(modules, modulesLength)

	-- nodejs
	files = generator.finalize()
	all = {}
	for k in pairs(to_be_zipped) do
		table.insert(all, k)
	end
	for k in pairs(files) do
		table.insert(all, k)
	end
	js.global:zipStockFiles(js.global:Array(table.unpack(all)))

	return meta
end

