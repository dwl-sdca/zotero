/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/


/*
 * Same structure as Zotero.Creators -- make changes in both places if possible
 */
Zotero.Tags = new function() {
	Zotero.DataObjects.apply(this, ['tag']);
	this.constructor.prototype = new Zotero.DataObjects();
	
	var _tags = {}; // indexed by tag text
	var _colorsByItem = {};
	
	this.get = get;
	this.getName = getName;
	this.getID = getID;
	this.getIDs = getIDs;
	this.getTypes = getTypes;
	this.getAll = getAll;
	this.getAllWithinSearch = getAllWithinSearch;
	this.getTagItems = getTagItems;
	this.search = search;
	this.rename = rename;
	this.erase = erase;
	this.purge = purge;
	
	
	/*
	 * Returns a tag and type for a given tagID
	 */
	function get(id, skipCheck) {
		if (this._reloadCache) {
			this.reloadAll();
		}
		return this._objectCache[id] ? this._objectCache[id] : false;
	}
	
	
	/*
	 * Returns a tag for a given tagID
	 */
	function getName(tagID) {
		if (this._objectCache[tagID]) {
			return this._objectCache[tagID].name;
		}
		
		// Populate cache
		var tag = this.get(tagID);
		
		return this._objectCache[tagID] ? this._objectCache[tagID].name : false;
	}
	
	
	/*
	 * Returns the tagID matching given tag and type
	 */
	function getID(name, type, libraryID) {
		name = Zotero.Utilities.trim(name);
		var lcname = name.toLowerCase();
		
		if (!libraryID) {
			libraryID = 0;
		}
		
		if (_tags[libraryID] && _tags[libraryID][type] && _tags[libraryID][type]['_' + lcname]) {
			return _tags[libraryID][type]['_' + lcname];
		}
		
		// FIXME: COLLATE NOCASE doesn't work for Unicode characters, so this
		// won't find Äbc if "äbc" is entered and will allow a duplicate tag
		// to be created
		var sql = "SELECT tagID FROM tags WHERE name=? AND type=? AND libraryID";
		var params = [name, type];
		if (libraryID) {
			sql += "=?";
			params.push(libraryID);
		}
		else {
			sql += " IS NULL";
		}
		var tagID = Zotero.DB.valueQuery(sql, params);
		if (tagID) {
			if (!_tags[libraryID]) {
				_tags[libraryID] = {};
			}
			if (!_tags[libraryID][type]) {
				_tags[libraryID][type] = [];
			}
			_tags[libraryID][type]['_' + lcname] = tagID;
		}
		
		return tagID;
	}
	
	
	/*
	 * Returns all tagIDs for this tag (of all types)
	 */
	function getIDs(name, libraryID) {
		name = Zotero.Utilities.trim(name);
		var sql = "SELECT tagID FROM tags WHERE name=? AND libraryID";
		var params = [name];
		if (libraryID) {
			sql += "=?";
			params.push(libraryID);
		}
		else {
			sql += " IS NULL";
		}
		return Zotero.DB.columnQuery(sql, params);
	}
	
	
	/*
	 * Returns an array of tag types for tags matching given tag
	 */
	function getTypes(name, libraryID) {
		name = Zotero.Utilities.trim(name);
		var sql = "SELECT type FROM tags WHERE name=? AND libraryID";
		var params = [name];
		if (libraryID) {
			sql += "=?";
			params.push(libraryID);
		}
		else {
			sql += " IS NULL";
		}
		return Zotero.DB.columnQuery(sql, params);
	}
	
	
	/**
	 * Get all tags indexed by tagID
	 *
	 * _types_ is an optional array of tag types to fetch
	 */
	function getAll(types, libraryID) {
		var sql = "SELECT tagID, name FROM tags WHERE libraryID";
		var params = [];
		if (libraryID) {
			sql += "=?";
			params.push(libraryID);
		}
		else {
			sql += " IS NULL";
		}
		if (types) {
			sql += " AND type IN (" + types.join() + ")";
		}
		if (params.length) {
			var tags = Zotero.DB.query(sql, params);
		}
		else {
			var tags = Zotero.DB.query(sql);
		}
		if (!tags) {
			return {};
		}
		
		var collation = Zotero.getLocaleCollation();
		tags.sort(function(a, b) {
			return collation.compareString(1, a.name, b.name);
		});
		
		var indexed = {};
		for (var i=0; i<tags.length; i++) {
			var tag = this.get(tags[i].tagID, true);
			indexed[tags[i].tagID] = tag;
		}
		return indexed;
	}
	
	
	/*
	 * Get all tags within the items of a Zotero.Search object
	 *
	 * _types_ is an optional array of tag types to fetch
	 */
	function getAllWithinSearch(search, types, tmpTable) {
		// Save search results to temporary table
		if(!tmpTable) {
			try {
				var tmpTable = search.search(true);
			}
			catch (e) {
				if (typeof e == 'string'
						&& e.match(/Saved search [0-9]+ does not exist/)) {
					Zotero.DB.rollbackTransaction();
					Zotero.debug(e, 2);
				}
				else {
					throw (e);
				}
			}
			if (!tmpTable) {
				return {};
			}
		}
		
		var sql = "SELECT DISTINCT tagID, name, type FROM itemTags "
			+ "NATURAL JOIN tags WHERE itemID IN "
			+ "(SELECT itemID FROM " + tmpTable + ") ";
		if (types) {
			sql += "AND type IN (" + types.join() + ") ";
		}
		var tags = Zotero.DB.query(sql);
		
		if(!tmpTable) {
			Zotero.DB.query("DROP TABLE " + tmpTable);
		}
		
		if (!tags) {
			return {};
		}
		
		var collation = Zotero.getLocaleCollation();
		tags.sort(function(a, b) {
			return collation.compareString(1, a.name, b.name);
		});
		
		var indexed = {};
		for (var i=0; i<tags.length; i++) {
			var tag = this.get(tags[i].tagID, true);
			indexed[tags[i].tagID] = tag;
		}
		return indexed;
	}
	
	
	/**
	 * Get the items associated with the given saved tag
	 *
	 * @param	{Integer}	tagID
	 * @return	{Integer[]|FALSE}
	 */
	function getTagItems(tagID) {
		var sql = "SELECT itemID FROM itemTags WHERE tagID=?";
		return Zotero.DB.columnQuery(sql, tagID);
	}
	
	
	function search(str) {
		var sql = 'SELECT tagID, name, type FROM tags';
		if (str) {
			sql += ' WHERE name LIKE ?';
		}
		var tags = Zotero.DB.query(sql, str ? '%' + str + '%' : undefined);
		
		if (!tags) {
			return {};
		}
		
		var collation = Zotero.getLocaleCollation();
		tags.sort(function(a, b) {
			return collation.compareString(1, a.name, b.name);
		});
		
		var indexed = {};
		for (var i=0; i<tags.length; i++) {
			var tag = this.get(tags[i].tagID, true);
			indexed[tags[i].tagID] = tag;
		}
		return indexed;
	}
	
	
	function rename(tagID, name) {
		Zotero.debug('Renaming tag', 4);
		
		name = Zotero.Utilities.trim(name);
		
		Zotero.DB.beginTransaction();
		
		var tagObj = this.get(tagID);
		var libraryID = tagObj.libraryID;
		var oldName = tagObj.name;
		var oldType = tagObj.type;
		var notifierData = {};
		notifierData[tagID] = { old: tagObj.serialize() };
		
		if (oldName == name) {
			Zotero.debug("Tag name hasn't changed", 2);
			Zotero.DB.commitTransaction();
			return;
		}
		
		var sql = "SELECT tagID, name FROM tags WHERE name=? AND type=0 AND libraryID=?";
		var row = Zotero.DB.rowQuery(sql, [name, libraryID]);
		if (row) {
			var existingTagID = row.tagID;
			var existingName = row.name;
		}
		// New tag already exists as manual tag
		if (existingTagID
				// Tag check is case-insensitive, so make sure we have a different tag
				&& existingTagID != tagID) {
			
			var changed = false;
			var itemsAdded = false;
			
			// Change case of existing manual tag before switching automatic
			if (oldName.toLowerCase() == name.toLowerCase() || existingName != name) {
				var sql = "UPDATE tags SET name=? WHERE tagID=?";
				Zotero.DB.query(sql, [name, existingTagID]);
				changed = true;
			}
			
			var itemIDs = this.getTagItems(tagID);
			var existingItemIDs = this.getTagItems(existingTagID);
			
			// Would be easier to just call removeTag(tagID) and addTag(existingID)
			// here, but this is considerably more efficient
			var sql = "UPDATE OR REPLACE itemTags SET tagID=? WHERE tagID=?";
			Zotero.DB.query(sql, [existingTagID, tagID]);
			
			// Manual purge of old tag
			sql = "DELETE FROM tags WHERE tagID=?";
			Zotero.DB.query(sql, tagID);
			if (_tags[libraryID] && _tags[libraryID][oldType]) {
				delete _tags[libraryID][oldType]['_' + oldName];
			}
			delete this._objectCache[tagID];
			Zotero.Notifier.trigger('delete', 'tag', tagID, notifierData);
			
			// Simulate tag removal on items that used old tag
			var itemTags = [];
			for (var i in itemIDs) {
				itemTags.push(itemIDs[i] + '-' + tagID);
			}
			Zotero.Notifier.trigger('remove', 'item-tag', itemTags);
			
			// And send tag add for new tag (except for those that already had it)
			var itemTags = [];
			for (var i in itemIDs) {
				if (!existingItemIDs || existingItemIDs.indexOf(itemIDs[i]) == -1) {
					itemTags.push(itemIDs[i] + '-' + existingTagID);
					itemsAdded = true;
				}
			}
			
			if (changed) {
				if (itemsAdded) {
					Zotero.Notifier.trigger('add', 'item-tag', itemTags);
				}
				
				// Mark existing tag as updated
				sql = "UPDATE tags SET dateModified=CURRENT_TIMESTAMP, "
						+ "clientDateModified=CURRENT_TIMESTAMP WHERE tagID=?";
				Zotero.DB.query(sql, existingTagID);
				Zotero.Notifier.trigger('modify', 'tag', existingTagID);
				Zotero.Tags.reload(existingTagID);
			}
			
			// TODO: notify linked items?
			//Zotero.Notifier.trigger('modify', 'item', itemIDs);
			
			Zotero.DB.commitTransaction();
			return;
		}
		
		tagObj.name = name;
		// Set all renamed tags to manual
		tagObj.type = 0;
		tagObj.save();
		
		Zotero.DB.commitTransaction();
	}
	
	
	this.getColor = function (name) {
		var tagColors = this.getColors();
		return tagColors[name] ? tagColors[name] : '#000000';
	}
	
	
	this.getColors = function (name) {
		var tagColors = Zotero.Prefs.get('tagColors');
		return tagColors ? JSON.parse(tagColors) : {};
	}
	
	
	this.getItemColor = function (itemID) {
		var item = Zotero.Items.get(itemID);
		if (!item) {
			return false;
		}
		
		// Init library tag colors if not yet done
		var libraryID = item.libraryID ? item.libraryID : 0;
		if (!_colorsByItem[libraryID]) {
			_colorsByItem[libraryID] = {};
			var tagColors = this.getColors();
			for (var name in tagColors) {
				var color = tagColors[name];
				var tagIDs = Zotero.Tags.getIDs(name, libraryID);
				if (!tagIDs) {
					continue;
				}
				for each(var tagID in tagIDs) {
					var tag = Zotero.Tags.get(tagID);
					var itemIDs = tag.getLinkedItems(true);
					if (!itemIDs) {
						continue;
					}
					for each(var id in itemIDs) {
						_colorsByItem[libraryID][id] = color;
					}
				}
			}
		}
		
		return _colorsByItem[libraryID][itemID] ? _colorsByItem[libraryID][itemID] : false;
	}
	
	
	this.setColor = function (name, color) {
		var tagColors = this.getColors();
		
		// Unset
		if (!color || color == '#000000') {
			delete tagColors[name];
		}
		else {
			tagColors[name] = color;
		}
		
		tagColors = JSON.stringify(tagColors);
		Zotero.Prefs.set('tagColors', tagColors);
		
		_reloadTagColors();
		Zotero.Notifier.trigger('redraw', 'item', []);
	}
	
	
	function _reloadTagColors() {
		_colorsByItem = {};
	}
	
	
	function erase(ids) {
		ids = Zotero.flattenArguments(ids);
		
		Zotero.DB.beginTransaction();
		for each(var id in ids) {
			var tag = this.get(id);
			if (tag) {
				tag.erase();
			}
		}
		Zotero.DB.commitTransaction();
	}
	
	
	/**
	 * Delete obsolete tags from database and clear internal array entries
	 *
	 * @param	[Integer[]|Integer]		[tagIDs]	tagID or array of tagIDs to purge
	 */
	function purge(tagIDs) {
		if (!tagIDs && !Zotero.Prefs.get('purge.tags')) {
			return;
		}
		
		if (tagIDs) {
			tagIDs = Zotero.flattenArguments(tagIDs);
		}
		
		Zotero.UnresponsiveScriptIndicator.disable();
		try {
			Zotero.DB.beginTransaction();
			
			// Use given tags
			if (tagIDs) {
				var sql = "CREATE TEMPORARY TABLE tagDelete (tagID INT PRIMARY KEY)";
				Zotero.DB.query(sql);
				for each(var id in tagIDs) {
					Zotero.DB.query("INSERT OR IGNORE INTO tagDelete VALUES (?)", id);
				}
				// Remove duplicates
				var toDelete = Zotero.DB.columnQuery("SELECT * FROM tagDelete");
			}
			// Look for orphaned tags
			else {
				var sql = "CREATE TEMPORARY TABLE tagDelete AS "
					+ "SELECT tagID FROM tags WHERE tagID "
					+ "NOT IN (SELECT tagID FROM itemTags)";
				Zotero.DB.query(sql);
				
				sql = "CREATE INDEX tagDelete_tagID ON tagDelete(tagID)";
				Zotero.DB.query(sql);
				
				sql = "SELECT * FROM tagDelete";
				var toDelete = Zotero.DB.columnQuery(sql);
				
				if (!toDelete) {
					sql = "DROP TABLE tagDelete";
					Zotero.DB.query(sql);
					Zotero.DB.commitTransaction();
					Zotero.Prefs.set('purge.tags', false);
					return;
				}
			}
			
			var notifierData = {};
			
			for each(var tagID in toDelete) {
				var tag = Zotero.Tags.get(tagID);
				if (tag) {
					notifierData[tagID] = { old: tag.serialize() }
				}
			}
			
			this.unload(toDelete);
			
			sql = "DELETE FROM tags WHERE tagID IN "
				+ "(SELECT tagID FROM tagDelete);";
			Zotero.DB.query(sql);
			
			sql = "DROP TABLE tagDelete";
			Zotero.DB.query(sql);
			
			Zotero.DB.commitTransaction();
			
			Zotero.Notifier.trigger('delete', 'tag', toDelete, notifierData);
		}
		catch (e) {
			Zotero.DB.rollbackTransaction();
			throw (e);
		}
		finally {
			Zotero.UnresponsiveScriptIndicator.enable();
		}
		
		Zotero.Prefs.set('purge.tags', false);
	}
	
	
	/**
	 * Internal reload hook to clear cache
	 */
	this._reload = function (ids) {
		_tags = {};
		_reloadTagColors();
	}
	
	
	/**
	 * Unload tags from caches
	 *
	 * @param	int|array	ids	 	One or more tagIDs
	 */
	this.unload = function () {
		var ids = Zotero.flattenArguments(arguments);
		
		for each(var id in ids) {
			var tag = this._objectCache[id];
			delete this._objectCache[id];
			var libraryID = tag.libraryID ? tag.libraryID : 0;
			if (tag && _tags[libraryID] && _tags[libraryID][tag.type]) {
				delete _tags[libraryID][tag.type]['_' + tag.name];
			}
		}
	}
	
	
	this._load = function () {
		if (!arguments[0]) {
			if (!this._reloadCache) {
				return;
			}
			_tags = {};
			this._reloadCache = false;
		}
		
		// This should be the same as the query in Zotero.Tag.load(),
		// just without a specific tagID
		var sql = "SELECT * FROM tags WHERE 1";
		if (arguments[0]) {
			sql += " AND tagID IN (" + Zotero.join(arguments[0], ",") + ")";
		}
		var rows = Zotero.DB.query(sql);
		
		var ids = [];
		for each(var row in rows) {
			var id = row.tagID;
			ids.push(id);
			
			// Tag doesn't exist -- create new object and stuff in array
			if (!this._objectCache[id]) {
				//this.get(id);
				this._objectCache[id] = new Zotero.Tag;
				this._objectCache[id].loadFromRow(row);
			}
			// Existing tag -- reload in place
			else {
				this._objectCache[id].loadFromRow(row);
			}
		}
		
		if (!arguments[0]) {
			// If loading all tags, remove old tags that no longer exist
			for each(var c in this._objectCache) {
				if (ids.indexOf(c.id) == -1) {
					this.unload(c.id);
				}
			}
		}
	}
}

